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
		if (isCheckrFile)
			continue; // Omit checkr.js files from checks.

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

/********* `code` support *********/
/** Copied from the typescript output folder. */

Object.defineProperty(exports, "__esModule", { value: true });
exports.code = exports.escapeRegExp = void 0;
String.prototype.replaceAll = function (stringOrRegex, replacement) {
    return stringOrRegex instanceof RegExp ?
        this.replace(new RegExp(stringOrRegex, stringOrRegex.flags.includes("g") ?
            stringOrRegex.flags :
            stringOrRegex.flags + "g"), // Warning: typical `replaceAll` throws in this scenario.
        replacement) :
        this.replace(new RegExp(escapeRegExp(stringOrRegex), 'g'), replacement);
};
// NOTE: 2 + 2 is still a literal. Base literals refers to unchained literals.
const baseLiterals = [
    `"[\\s\\S]*?"`,
    "'[\\s\\S]*?'",
    '`[\\s\\S]*?`',
    '-?\\d+([\\w\\.]*\\d*)*',
    `\/[\\s\\S]*?\/`,
    'true',
    'false',
    'NaN',
    'undefined',
    'null'
];
const baseLiteralRegex = `(${baseLiterals.join("|")})`;
const unitaryOperators = ['++', '--', '~'];
const binaryOperators = [
    `+`,
    '-',
    `*`,
    `**`,
    `/`,
    '%',
    '=',
    '==',
    '===',
    '!=',
    '!==',
    '>',
    '<',
    '>=',
    '<=',
    '&',
    `|`,
    '^',
    '<<',
    '>>',
    '>>>'
];
// Excludes ternaries.
const operatorRegex = `(${unitaryOperators.map(escapeRegExp).concat(binaryOperators.map(escapeRegExp)).join("|")})`;
// Includes "future" reserved keywords.
const keywords = [
    'break',
    'case',
    'catch',
    'class',
    'const',
    'continue',
    'debugger',
    'default',
    'delete',
    'do',
    'else',
    'export',
    'extends',
    'finally',
    'for',
    'function',
    'if',
    'import',
    'in',
    'instanceof',
    'new',
    'return',
    'super',
    'switch',
    'this',
    'throw',
    'try',
    'typeof',
    'var',
    'void',
    'while',
    'with',
    'yield',
    'enum',
    'implements',
    'interface',
    'let',
    'package',
    'private',
    'protected',
    'public',
    'static',
    'yield',
    'await'
];
const keywordRegex = `(${keywords.join('|')})`;
const capturedVariableRegex = `(?!(?:do|if|in|for|let|new|try|var|case|else|enum|eval|false|null|this|true|void|with|break|catch|class|const|super|throw|while|yield|delete|export|import|public|return|static|switch|typeof|default|extends|finally|package|private|continue|debugger|function|arguments|interface|protected|implements|NaN|undefined|instanceof)$)([$A-Z_a-z]+[$A-Z_a-z0-9]*)`;
const variablePrefix = "_";
const literalPrefix = "__";
const operatorPrefix = "___";
const keywordPrefix = "____";
const blockPrefix = "_____";
function createNamedVariableRegex(name) {
    // Greatly trimmed down and slightly modified from https://stackoverflow.com/questions/1661197/what-characters-are-valid-for-javascript-variable-names
    return `(?!(?:do|if|in|for|let|new|try|var|case|else|enum|eval|false|null|this|true|void|with|break|catch|class|const|super|throw|while|yield|delete|export|import|public|return|static|switch|typeof|default|extends|finally|package|private|continue|debugger|function|arguments|interface|protected|implements|NaN|undefined|instanceof)$)(?<${name}>[$A-Z_a-z]+[$A-Z_a-z0-9]*)`;
}
function createNamedLiteralRegex(name) {
    return `(?<${name}>${baseLiteralRegex})`;
}
function createNamedOperatorRegex(name) {
    return `(?<${name}>${operatorRegex})`;
}
function createNamedKeywordRegex(name) {
    return `(?<${name}>${keywordRegex})`;
}
// Copied from MDN docs.
function escapeRegExp(theString) {
    return theString.replace(/[.*+\-?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}
exports.escapeRegExp = escapeRegExp;
function uniqueCaptureGroupName() {
    // https://stackoverflow.com/a/57593036/16617265
    return (new Date()).getTime().toString(36) + Math.random().toString(36).slice(2);
}
// Example usages:
//	code`if ($a == $b) { return $a; }`;
//	code`$#operator($1);`;
function code(strings, ...expressions) {
    let regexTranslation = strings[0];
    for (let i = 0; i < expressions.length; i++)
        regexTranslation += expressions[i] + strings[i + 1];
    // Tokenize special syntax before whitespace is inserted.
    regexTranslation = regexTranslation.replaceAll("$$$", ":🍇:");
    regexTranslation = regexTranslation.replaceAll("$$", ":🍉:");
    const variableTokens = [];
    const literalTokens = [];
    const operatorTokens = [];
    const keywordTokens = [];
    const regexTokens = [];
    let match;
    while ((match = regexTranslation.match(/\$[a-zA-Z]+[0-9_]*/))) {
        variableTokens.push(match);
        regexTranslation = regexTranslation.replace(match, " :🍊: ");
    }
    while ((match = regexTranslation.match(/\$[0-9]+/))) {
        literalTokens.push(match);
        regexTranslation = regexTranslation.replace(match, " :🍍: ");
    }
    while ((match = regexTranslation.match(/\$@([a-zA-Z]+[0-9_]*)?/))) {
        operatorTokens.push(match[0]);
        regexTranslation = regexTranslation.replace(match[0], " :🍎: ");
    }
    while ((match = regexTranslation.match(/\$#([a-zA-Z]+[0-9_]*)?/))) {
        keywordTokens.push(match[0]);
        regexTranslation = regexTranslation.replace(match[0], " :🍓: ");
    }
    while ((match = regexTranslation.match(/REGEX\(([\s\S]*?)\)/))) {
        regexTokens.push(match[1]);
        regexTranslation = regexTranslation.replace(match[0], " :🍈: ");
    }
    // Insert whitespace between literals, variables, and keywords.
    // Makes it easier to deal with scenarios such as `a+10` or `++a`.
    regexTranslation = regexTranslation.replaceAll(new RegExp(capturedVariableRegex, "g"), " $1 ");
    regexTranslation = regexTranslation.replaceAll(new RegExp(`(${baseLiteralRegex})`, "g"), " $1 ");
    regexTranslation = regexTranslation.replaceAll(new RegExp(`(${keywordRegex})`, "g"), " $1 ");
    // Insert whitespace between `{}`, `()`, and `[]`.
    // Makes it easier to deal with scenarios such as `if()` vs `if ()`.
    regexTranslation = regexTranslation.replaceAll('(', ' ( ');
    regexTranslation = regexTranslation.replaceAll(')', ' ) ');
    regexTranslation = regexTranslation.replaceAll('{', ' { ');
    regexTranslation = regexTranslation.replaceAll('}', ' } ');
    regexTranslation = regexTranslation.replaceAll('[', ' [ ');
    regexTranslation = regexTranslation.replaceAll(']', ' ] ');
    // Insert whitespace between `;`
    regexTranslation = regexTranslation.replaceAll(";", " ; ");
    // Handles overlap between JavaScript and RegExp. For example, `+` needs to be escaped because it has a different meaning in RegExp.
    regexTranslation = escapeRegExp(regexTranslation);
    // Re-add tokens
    let vi = 0;
    while (regexTranslation.includes(":🍊:"))
        regexTranslation = regexTranslation.replace(":🍊:", variableTokens[vi++]);
    let li = 0;
    while (regexTranslation.includes(":🍍:"))
        regexTranslation = regexTranslation.replace(":🍍:", literalTokens[li++]);
    let oi = 0;
    while (regexTranslation.includes(":🍎:"))
        regexTranslation = regexTranslation.replace(":🍎:", operatorTokens[oi++]);
    let ki = 0;
    while (regexTranslation.includes(":🍓:"))
        regexTranslation = regexTranslation.replace(":🍓:", keywordTokens[ki++]);
    // Replace special characters, eg `$a`, `$1`, `$#a`, `$@a` etc.
    regexTranslation = replaceVariablesWithRegex(regexTranslation);
    regexTranslation = replaceLiteralsWithRegex(regexTranslation);
    regexTranslation = replaceOperatorsWithRegex(regexTranslation);
    regexTranslation = replaceKeywordsWithRegex(regexTranslation);
    while (regexTranslation.includes(":🍇:"))
        regexTranslation = regexTranslation.replace(":🍇:", `(?<${blockPrefix}${uniqueCaptureGroupName()}>[\\s\\S]*)`);
    while (regexTranslation.includes(":🍉:"))
        regexTranslation = regexTranslation.replace(":🍉:", `(?<${blockPrefix}${uniqueCaptureGroupName()}>[\\s\\S]*?)`);
    // Replace whitespace with lenient whitespace skips.
    const lenientSkip = '[\\s]*';
    regexTranslation = regexTranslation.replace(new RegExp('[\\s]+', 'g'), lenientSkip);
    // Remove preceding and trailing whitespace matcher. Handles cases such as `if ($a == $b) { $$ }` doesn't match "if (foo == bar) { baz(); }   \n\n    "
    if (regexTranslation.startsWith(lenientSkip))
        regexTranslation = regexTranslation.replace('[\\s]*', "");
    if (regexTranslation.endsWith(lenientSkip))
        regexTranslation = regexTranslation.substring(0, regexTranslation.length - lenientSkip.length);
    // Re-add "escape hatch" regex.
    let ri = 0;
    while (regexTranslation.includes(":🍈:"))
        regexTranslation = regexTranslation.replace(":🍈:", regexTokens[ri++]);
    const extendedRegex = new RegExp(regexTranslation, "g");
    extendedRegex.matchAll = function (str) {
        return [...str.matchAll(extendedRegex)].map(parseMatch);
    };
    extendedRegex.matchFirst = function (str) {
        return [...str.matchAll(extendedRegex)].map(parseMatch)[0] || {
            variables: [],
            literals: [],
            keywords: [],
            operators: [],
            blocks: [],
            others: []
        };
    };
    return extendedRegex;
}
exports.code = code;
function parseMatch(match) {
    const results = {
        variables: [],
        literals: [],
        keywords: [],
        operators: [],
        blocks: [],
        others: []
    };
    // This can occur in situations where no named capture groups are provided.
    // Thus there still is a "match", it's just empty.
    if (match == null || match.groups == null)
        return results;
    for (const [kind, value] of Object.entries(match.groups)) {
        // Warning: `if` order matters.
        if (kind.startsWith(blockPrefix))
            results.blocks.push(value);
        else if (kind.startsWith(keywordPrefix))
            results.keywords.push(value);
        else if (kind.startsWith(operatorPrefix))
            results.operators.push(value);
        else if (kind.startsWith(literalPrefix))
            results.literals.push(value);
        else if (kind.startsWith(variablePrefix))
            results.variables.push(value);
        else
            results.others.push(value);
    }
    return results;
}
/*
 * Note to future maintainer/self:
 * Please do not "DRY" up the below code with a function generator (unless it can be done well).
 * Consider a code generator if it's too tedious to add more functions. (Or refactor the whole algorithm).
 */
// Converts code variable matchers such as $a, $b, $foo, etc with regex.
// Handles complex replacements such as repeated variable captures, eg `$a == $a`.
function replaceVariablesWithRegex(codeString) {
    const captureRegex = /\$([a-zA-Z]+[0-9_]*)/g;
    const matches = codeString.match(captureRegex);
    if (matches == null)
        return codeString;
    const encounteredVariables = new Set();
    let result = codeString;
    for (const match of matches) {
        const normalizedName = match.replace('$', '');
        if (encounteredVariables.has(normalizedName)) {
            // Replace match with back reference, eg `$foobar` becomes `\k<PREFIX_foobar>`.
            result = result.replace(match, `\\k<${variablePrefix}${normalizedName}>`);
        }
        else {
            // Replace match with variable regex, eg `$foobar` becomes `(?<PREFIX_foobar>VAR_REGEX_STRING)`.
            result = result.replace(match, createNamedVariableRegex(`${variablePrefix}${normalizedName}`));
            encounteredVariables.add(normalizedName);
        }
    }
    return result;
}
// Converts code literal matchers such as $1, $2, $99, etc with regex.
// Handles complex replacements such as repeated literal captures, eg `$1 == $1`.
function replaceLiteralsWithRegex(codeString) {
    const captureRegex = /\$([0-9]+)/g;
    const matches = codeString.match(captureRegex);
    if (matches == null)
        return codeString;
    const encounteredLiterals = new Set();
    let result = codeString;
    for (const match of matches) {
        const normalizedName = match.replace('$', '');
        if (encounteredLiterals.has(normalizedName)) {
            // Replace match with back reference, eg `$1` becomes `\k<PREFIX_1>`.
            result = result.replace(match, `\\k<${literalPrefix}${normalizedName}>`);
        }
        else {
            // Replace match with literal regex, eg `$1` becomes `(?<PREFIX_1>LITERAL_REGEX_STRING)`.
            result = result.replace(match, createNamedLiteralRegex(`${literalPrefix}${normalizedName}`));
            encounteredLiterals.add(normalizedName);
        }
    }
    return result;
}
// Converts code operator matchers such as $@, $@op, etc with regex.
// Handles complex replacements such as repeated operator captures, eg `$@op $a $@op`.
function replaceOperatorsWithRegex(codeString) {
    const captureRegex = /\$@([a-zA-Z]+[0-9_]*)?/g;
    const matches = codeString.match(captureRegex);
    if (matches == null)
        return codeString;
    const encounteredOperators = new Set();
    let result = codeString;
    for (const match of matches) {
        const normalizedName = match.replace('$@', '') || uniqueCaptureGroupName();
        if (encounteredOperators.has(normalizedName)) {
            // Replace match with back reference, eg `$@op` becomes `\k<PREFIX_op>`.
            result = result.replace(match, `\\k<${operatorPrefix}${normalizedName}>`);
        }
        else {
            // Replace match with literal regex, eg `$@op` becomes `(?<PREFIX_op>OPERATOR_REGEX_STRING)`.
            result = result.replace(match, createNamedOperatorRegex(`${operatorPrefix}${normalizedName}`));
            encounteredOperators.add(normalizedName);
        }
    }
    return result;
}
// Converts code keyword matchers such as $#, $#a, $#keyword1, etc with regex.
// Handles complex replacements such as repeated keyword captures, eg `$#keyword1 { $$ } $#keyword1`.
function replaceKeywordsWithRegex(codeString) {
    const captureRegex = /\$#([a-zA-Z]+[0-9_]*)?/g;
    const matches = codeString.match(captureRegex);
    if (matches == null)
        return codeString;
    const encounteredKeywords = new Set();
    let result = codeString;
    for (const match of matches) {
        const normalizedName = match.replace('$#', '') || uniqueCaptureGroupName();
        if (encounteredKeywords.has(normalizedName)) {
            // Replace match with back reference, eg `$#keyword` becomes `\k<PREFIX_keyword>`.
            result = result.replace(match, `\\k<${keywordPrefix}${normalizedName}>`);
        }
        else {
            // Replace match with literal regex, eg `$#keyword` becomes `(?<PREFIX_keyword>KEYWORD_REGEX_STRING)`.
            result = result.replace(match, createNamedKeywordRegex(`${keywordPrefix}${normalizedName}`));
            encounteredKeywords.add(normalizedName);
        }
    }
    return result;
}

process.exit(checkStatus);
