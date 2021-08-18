'use strict';

const path = require('path');
const fs = require('fs');
const child_process = require('child_process');
const exec = child_process.execSync;

let checkStatus = 0; // Set to 1 if any step goes wrong.
const projectRoot = process.cwd(); // Should be set to the git project root by hooks.
const stagedFiles = exec('git diff --staged --name-only', { encoding: 'utf8' })
	.toString()
	.split('\n')
	.filter((x) => x);

for (const stagedFile of stagedFiles) {
	const stagedFilePath = path.resolve(projectRoot, stagedFile);
	let fileContents;
	try {
		fileContents = fs.readFileSync(stagedFilePath, { encoding: 'utf-8' });
	} catch {
		// File was locked, didn't exist, etc. Do nothing.
		continue;
	}

	// Eg ['C:', 'foo', 'bar', 'example.js']
	const filePathSegments = stagedFilePath.split('\\');

	// Eg 'example'. Extension not included.
	const fileName = filePathSegments.pop().replace(/\.[^/.]+$/, '');

	// Eg 'C:\foo\bar'. Trailing slash not included. Filename not included.
	const filePath = filePathSegments.join('\\');

	// Eg 'js'. Leading period not included.
	const fileExtension = (fileName && path.extname(stagedFilePath).substring(1)) || '';

	const file = Object.freeze({
		fileContents,
		filePath,
		fileName,
		fileExtension,
	});

	const lineNumberRanges = getLineNumberRanges(fileContents);

	const boundLogToConsole = (regexOrText, checkMessage, alert) =>
		logToConsole(regexOrText, checkMessage, stagedFile, fileContents, lineNumberRanges, alert);

	const checks = readCheckrFiles(filePathSegments);
	for (const check of checks) {
		const isCheckrFile = fileName === 'checkr' && fileExtension === 'js';
		if (isCheckrFile) {
			continue; // Omit checkr.js files from checks.
		}

		// 'boundLogToConsole' is passed again as a second arg for backwards compatibility.
		check({ ...file, fs, path, child_process, code, underline: boundLogToConsole }, boundLogToConsole);
	}
}

// Eg c$\code\coolproject should be passed as [c$, code, coolproject].
function readCheckrFiles(filePathSegments) {
	const checks = [];
	const segments = filePathSegments;

	// Navigate up the file tree looking for checkr.js files to parse.
	while (segments.length !== 0) {
		const path = `${segments.join('\\')}\\checkr.js`;
		try {
			const checkrFileContents = fs.readFileSync(path, 'utf8');

			// Prevents newly created checkr.js files from throwing errors.
			if (checkrFileContents === '')
				continue;

			// Warning: arrays of functions console.log as "[null, null, null]" when they are not actually null.
			const evalChecks = new Function(`return ${checkrFileContents}`)();

			const evalCheckIsArray = Array.isArray(evalChecks);
			if (!evalCheckIsArray) {
				checkStatus = 1;
				console.log(
					`[Bad checkr.js file] checkr.js must contain a single array of functions.\npath: ${path}\n`,
				);
				continue;
			}

			const evalChecksValid = evalChecks.every((evalCheck) => evalCheck instanceof Function);
			if (!evalChecksValid) {
				checkStatus = 1;
				console.log(
					`[Bad checkr.js file] checkr.js array elements must be functions.\npath: ${path}\n`,
				);
				continue;
			}

			checks.push(...evalChecks);
		} catch (e) {
			// If no checkr file, bad parse, etc then do nothing.
			if (e instanceof SyntaxError) {
				checkStatus = 1;
				console.log(
					`[Bad checkr.js file] checkr.js error ${path}\nError message: ${e.message}\nStack: ${e.stack}\n`,
				);
			}
		} finally {
			// Note this occurs even on continues.
			segments.pop();
		}
	}

	return checks;
}

function logToConsole(regexOrText, checkMessage, filePath, fileContents, lineNumberRanges, alert) {
	// Validate args passed in by consumers.
	if (typeof regexOrText !== 'string' && !(regexOrText instanceof RegExp)) {
		checkStatus = 1;
		console.log(
			'[Bad checkr.js file] regexOrText must be a string or RegExp. Check your checkr.js files.\n',
		);
		return;
	}

	if (typeof checkMessage !== 'string') {
		checkStatus = 1;
		console.log(
			'[Bad checkr.js file] hoverMessage must be a string. Check your checkr.js files.\n',
		);
		return;
	}

	const regex =
		typeof regexOrText === 'string' ? new RegExp(escapeRegExp(regexOrText), 'g') : regexOrText;
	const checkMatches = [];

	const limit = 50;
	let counter = 0;
	let match;
	const existingMatches = new Set();
	while ((match = regex.exec(fileContents)) != null) {
		// Mitigate excessive backtracking cases.
		counter++;
		if (counter > limit)
			break;

		// Prevent regex expressions that infinitely loop.
		const matchIdentity = `${match.index}-${match[0].length}`;
		const loopDetected = existingMatches.has(matchIdentity);
		if (loopDetected)
			break;
		existingMatches.add(matchIdentity);

		const startPosition = match.index;
		const checkMatch = { startPosition, matchString: match[0] };
		checkMatches.push(checkMatch);
	}

	if (checkMatches.length === 0)
		return;

	let alertLevel = alert;
	if (alertLevel !== 'error' && alertLevel !== 'warn' && alertLevel !== 'warning' && alertLevel !== 'info')
		alertLevel = 'error'; // Default to error.

	// Console color codes.
	const redTextColor = '\x1b[31m';
	const yellowTextColor = '\x1b[33m';
	const cyanTextColor = '\x1b[36m';
	const resetColor = '\x1b[0m';

	let alertTextColor;
	if (alertLevel === 'error')
		alertTextColor = redTextColor;
	else if (alertLevel === 'warn' || alertLevel === 'warning')
		alertTextColor = yellowTextColor;
	else if (alertLevel === 'info')
		alertTextColor = cyanTextColor;

	console.log(`${alertTextColor}${alertLevel}${resetColor} ${checkMessage}`);

	for (const checkInfo of checkMatches) {
		if (alert === 'error')
			checkStatus = 1;
		const lineNumber = getLineNumber(checkInfo.startPosition, lineNumberRanges);
		console.log(`\n${filePath}:${lineNumber}\n${checkInfo.matchString}`);
	}
}

// Copied from MDN docs.
function escapeRegExp(theString) {
	return theString.replace(/[.*+\-?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

/*
* Input: "hello\n World how\n are you?"
* Output: [
	0,7, 	// 'hello\n', 		line 1 [start index:end index]
	8,19, 	// ' World how\n'	line 2 [start index:end index]
	20,28 	// ' are you?' 		line 3 [start index:end index]
]
*/
function getLineNumberRanges(fileContents) {
	let index = 0;
	const lineNumberRanges = fileContents.split('\n').flatMap((line) => {
		const lineStartIndex = index;
		// Typically one should avoid mutation in maps, but who's watching?
		index = index + line.length + '\n'.length;
		const lineEndIndex = index;

		return [lineStartIndex, lineEndIndex];
	});

	// Fix last lineEndIndex.
	// If file contents don't end with "\n", lineEndIndex is too large.
	if (!fileContents.endsWith('\n'))
		lineNumberRanges[lineNumberRanges.length - 1] -= '\n'.length;

	return lineNumberRanges;
}

function getLineNumber(position, lineNumberRanges) {
	const lastIndex = lineNumberRanges.length - 1;
	const rangeMax = lineNumberRanges[lastIndex];
	if (position > rangeMax)
		throw new Error(`index of ${position} must not be greater than rangeMax of ${rangeMax}`);
	if (position < 0)
		throw new Error('index must be non-negative.');


	// Simple binary search for lowerbound.
	let leftIndex = 0;
	let rightIndex = lastIndex;
	while (leftIndex <= rightIndex) {
		const middleIndex = Math.floor((rightIndex + leftIndex) / 2);
		if (lineNumberRanges[middleIndex] < position)
			leftIndex = middleIndex + 1;
		else
			rightIndex = middleIndex - 1;
	}

	// Each line has a start and end position in the lineNumberRanges array,
	// so divide the leftIndex by 2, add 1, and take the floor to get the associated line number.
	const lineNumber = Math.floor(leftIndex / 2 + 1);
	return lineNumber;
}

process.exit(checkStatus);
