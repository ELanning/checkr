import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
	const disposable = vscode.commands.registerTextEditorCommand(
		'checkr.runAnalysis',
		(textEditor) => {
			const previousDecorations = context.workspaceState.get<vscode.TextEditorDecorationType[]>(
				textEditor.document.fileName,
				[],
			);

			// Clear previous decorations to prevent redundant warnings.
			for (const decoration of previousDecorations) {
				try {
					decoration.dispose();
				} catch {
					// May have already been disposed of elsewhere.
				}
			}
			context.workspaceState.update(textEditor.document.fileName, []);

			// Eg ['C:', 'foo', 'bar', 'example.js']
			const filePathSegments = textEditor.document.fileName.split('\\');

			// Eg 'example'. Extension not included.
			const fileName = filePathSegments.pop()?.replace(/\.[^/.]+$/, '');

			// Eg 'C:\foo\bar'. Trailing slash not included. Filename not included.
			const filePath = filePathSegments.join('\\');

			// Eg 'js'. Leading period not included.
			const fileExtension =
				(fileName && path.extname(textEditor.document.fileName).substring(1)) ?? '';

			// Eg 'console.log('in foobar.js');'
			const fileContents = textEditor.document.getText();

			const file = Object.freeze({
				fileContents,
				filePath,
				fileName,
				fileExtension,
			});

			const boundUnderline = (
				regexOrText: RegExp | string,
				hoverMessage: string,
				alertLevel: AlertLevel,
			) => underline(regexOrText, hoverMessage, textEditor, context, alertLevel);

			const checks = readCheckrFiles(filePathSegments);
			for (const check of checks) {
				const isCheckrFile = fileName === 'checkr' && fileExtension === 'js';
				if (isCheckrFile) {
					continue; // Omit checkr.js files from checks.
				}

				check(file, boundUnderline);
			}
		},
	);

	vscode.workspace.onWillSaveTextDocument(() => {
		vscode.commands.executeCommand('checkr.runAnalysis');
	});

	vscode.window.onDidChangeActiveTextEditor(() => {
		vscode.commands.executeCommand('checkr.runAnalysis');
	});

	// Run command on activation, so that the first open file gets checked.
	vscode.commands.executeCommand('checkr.runAnalysis');

	context.subscriptions.push(disposable);
}

export function deactivate() { }

// Eg c$\code\coolproject should be passed as [c$, code, coolproject].
function readCheckrFiles(filePathSegments: string[]): Function[] {
	const checks: Function[] = [];
	const segments = filePathSegments;

	// Navigate up the file tree looking for checkr.js files to parse.
	while (segments.length !== 0) {
		const path = `${segments.join('\\')}\\checkr.js`;
		try {
			const checkrFileContents = fs.readFileSync(path, 'utf8');

			// Prevents newly created checkr.js files from throwing errors.
			if (checkrFileContents === '') {
				continue;
			}

			// Warning: arrays of functions console.log as "[null, null, null]" when they are not actually null.
			const evalChecks: Function[] = new Function(`return ${checkrFileContents}`)();

			const evalCheckIsArray = Array.isArray(evalChecks);
			if (!evalCheckIsArray) {
				vscode.window.showErrorMessage('checkr.js must contain a single array of functions.');
				continue;
			}

			const evalChecksValid = evalChecks.every((evalCheck) => evalCheck instanceof Function);
			if (!evalChecksValid) {
				vscode.window.showErrorMessage('checkr.js array elements must be functions.');
				continue;
			}

			checks.push(...evalChecks);
		} catch (e) {
			// If no checkr file, bad parse, etc then do nothing.
			if (e instanceof SyntaxError) {
				vscode.window.showErrorMessage(
					`checkr.js error ${path}\nError message: ${e.message}\nStack: ${e.stack}`,
				);
			}
		} finally {
			// Note this occurs even on continues.
			segments.pop();
		}
	}

	return checks;
}

const infoUnderlineStyle = {
	color: 'invalid; border-bottom: dashed 1px #17a2b8',
};
const warnUnderlineStyle = {
	color: 'invalid; border-bottom: dashed 1px #ffc107',
};
const errorUnderlineStyle = {
	color: 'invalid; border-bottom: dashed 1px #dc3545',
};
type AlertLevel = 'info' | 'warn' | 'error';

function underline(
	regexOrText: RegExp | string,
	hoverMessage: string,
	textEditor: vscode.TextEditor, // Mutates passed in textEditor.
	context: vscode.ExtensionContext, // Mutates passed in context.
	alert?: AlertLevel,
) {
	// Validate args passed in by consumers.
	if (typeof regexOrText !== 'string' && !(regexOrText instanceof RegExp)) {
		vscode.window.showErrorMessage(
			'regexOrText must be a string or RegExp. Check your checkr.js files.',
		);
		return;
	}

	if (typeof hoverMessage !== 'string') {
		vscode.window.showErrorMessage('hoverMessage must be a string. Check your checkr.js files.');
		return;
	}

	const regex =
		typeof regexOrText === 'string' ? new RegExp(escapeRegExp(regexOrText), 'g') : regexOrText;
	const fileContents = textEditor.document.getText();
	const decorations = [];

	const limit = 50;
	let counter = 0;
	let match;
	const existingMatches = new Set<string>();
	while ((match = regex.exec(fileContents)) != null) {
		// Mitigate excessive backtracking cases.
		counter++;
		if (counter > limit) {
			break;
		}

		// Prevent regex expression that infinitely loop.
		const matchIdentity = `${match.index}-${match[0].length}`;
		const loopDetected = existingMatches.has(matchIdentity);
		if (loopDetected) {
			break;
		}
		existingMatches.add(matchIdentity);

		const startPosition = textEditor.document.positionAt(match.index);
		const endPosition = textEditor.document.positionAt(match.index + match[0].length);
		const decoration = { range: new vscode.Range(startPosition, endPosition), hoverMessage };
		decorations.push(decoration);
	}

	if (decorations.length === 0) {
		return;
	}

	let underlineDecorationType;
	if (alert === 'info') {
		underlineDecorationType = vscode.window.createTextEditorDecorationType(infoUnderlineStyle);
	} else if (alert === 'warn') {
		underlineDecorationType = vscode.window.createTextEditorDecorationType(warnUnderlineStyle);
	} else if (alert === 'error') {
		underlineDecorationType = vscode.window.createTextEditorDecorationType(errorUnderlineStyle);
	} else {
		// Default to error on unrecognized or unset alert level.
		// Should possibly warn about unrecognized cases. UX undecided.
		underlineDecorationType = vscode.window.createTextEditorDecorationType(errorUnderlineStyle);
	}

	textEditor.setDecorations(underlineDecorationType, decorations);
	context.subscriptions.push(underlineDecorationType);

	// Link the new underlineDecorationType to the file.
	const fileKey = textEditor.document.fileName;
	const existingDecorations = context.workspaceState.get<vscode.TextEditorDecorationType[]>(
		fileKey,
		[],
	);
	context.workspaceState.update(fileKey, [...existingDecorations, underlineDecorationType]);
}

// NOTE: 2 + 2 is still a literal. Base literals refers to unchained literals.
const baseLiterals = [
	`"[\\s\\S]*?"`,
	"'[\\s\\S]*?'",
	'`[\\s\\S]*?`', // TODO: handle templates, eg styled`foobar`.
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
const keywordPrefix = "____"
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


let chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP";
let a = "a";
function uniqueCaptureGroupName() {
	if (a.length > 8)
		a = chars[chars.indexOf(a) + 1];
	a = a + a;
	return a;
}

// Example usages:
//	code`if ($a == $b) { return $a; }`;
//	code`$#operator($1);`;
export function code(strings, ...expressions) {
	let regexTranslation = strings[0];
	for (let i = 0; i < expressions.length; i++)
		regexTranslation += expressions[i] + strings[i + 1];

	// Insert whitespace between literals, variables, and keywords.
	// Makes it easier to deal with scenarios such as `a+10` or `++a`.
	regexTranslation = regexTranslation.replaceAll(new RegExp(capturedVariableRegex, "g"), " $1 ")
	regexTranslation = regexTranslation.replaceAll(new RegExp(`(${baseLiteralRegex})`, "g"), " $1 ")
	regexTranslation = regexTranslation.replaceAll(new RegExp(`(${keywordRegex})`, "g"), " $1 ")

	// Fix incorrect spacing added to special characters `$a`, `$1`, etc.
	regexTranslation = regexTranslation.replaceAll("$ ", "$")
	regexTranslation = regexTranslation.replaceAll("@ ", "@")
	regexTranslation = regexTranslation.replaceAll("# ", "#")

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

	// Handles overlap between JavaScript and RegExp. For example `+` needs to be escaped because it has a different meaning in RegExp.
	// First, safe replace the custom symbols such as `$a`, `$1`, `$#a`, `$@a`, and `$$`.
	regexTranslation = regexTranslation.replaceAll("$", "__<rep>__");  // Arbitary replacement sequence.
	regexTranslation = escapeRegExp(regexTranslation);
	regexTranslation = regexTranslation.replaceAll("__<rep>__", "$");

	// Replace special characters, eg `$a`, `$1`, `$#a`, `$@a` etc.
	regexTranslation = replaceVariablesWithRegex(regexTranslation);
	regexTranslation = replaceLiteralsWithRegex(regexTranslation);
	regexTranslation = replaceOperatorsWithRegex(regexTranslation);
	regexTranslation = replaceKeywordsWithRegex(regexTranslation);
	while (regexTranslation.includes("$$$"))
		regexTranslation = regexTranslation.replace("$$$", `(?<${blockPrefix}${uniqueCaptureGroupName()}>[\\s\\S]*)`);
	while (regexTranslation.includes("$$"))
		regexTranslation = regexTranslation.replace("$$", `(?<${blockPrefix}${uniqueCaptureGroupName()}>[\\s\\S]*?)`);

	// Replace whitespace with lenient whitespace skips.
	const lenientSkip = '[\\n\\r\\s]*';
	regexTranslation = regexTranslation.replace(new RegExp('[\\n\\r\\s]+', 'g'), lenientSkip);

	// Remove preceding and trailing whitespace matcher. Handles cases such as `if ($a == $b) { $$ }` doesn't match "if (foo == bar) { baz(); }   \n\n    "
	if (regexTranslation.startsWith(lenientSkip))
		regexTranslation = regexTranslation.replace('[\\n\\r\\s]*', "");

	if (regexTranslation.endsWith(lenientSkip))
		regexTranslation = regexTranslation.substring(0, regexTranslation.length - lenientSkip.length);

	const extendedRegex = new RegExp(regexTranslation, "g") as any;
	extendedRegex.matchAll = function (str) {
		const captures = [];
		const matches = str.matchAll(extendedRegex);

		for (const match of matches) {
			const results = {
				variables: [],
				literals: [],
				keywords: [],
				operators: [],
				blocks: [],
				others: []
			}
			for (const [kind, value] of Object.entries(match.groups)) {
				// Warning: `if` order matters.
				if (kind.startsWith(blockPrefix)) {
					results.blocks.push(value);
				} else if (kind.startsWith(keywordPrefix)) {
					results.keywords.push(value);
				} else if (kind.startsWith(operatorPrefix)) {
					results.operators.push(value);
				} else if (kind.startsWith(literalPrefix)) {
					results.literals.push(value);
				} else if (kind.startsWith(variablePrefix)) {
					results.variables.push(value);
				} else {
					results.others.push(value);
				}
			}
			captures.push(results);
		}

		return captures;
	}

	return extendedRegex;
}

// Converts code variable matchers such as $a, $b, $foo, etc with regex.
// Handles complex replacements such as repeated variable captures, eg `$a == $a`.
function replaceVariablesWithRegex(codeString) {
	const captureRegex = /\$([a-zA-z]+[0-9_]*)/g;
	const matches = codeString.match(captureRegex);
	if (matches == null)
		return codeString;

	const encounteredVariables = new Set();
	let result = codeString;

	for (const match of matches) {
		if (encounteredVariables.has(match)) {
			// Replace match with back reference, eg `$foobar` becomes `\k<_foobar>`.
			result = result.replace(match, `\\k<${variablePrefix}${match.replace('$', '')}>`);
		} else {
			// Replace match with variable regex, eg `$foobar` becomes `(?<_foobar>VAR_REGEX_STRING)`.
			result = result.replace(match, createNamedVariableRegex(`${variablePrefix}${match.replace('$', '')}`))
			encounteredVariables.add(match);
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
		if (encounteredLiterals.has(match)) {
			// Replace match with back reference, eg `$1` becomes `\k<__1>`.
			result = result.replace(match, `\\k<${literalPrefix}${match.replace('$', '')}>`);
		} else {
			// Replace match with literal regex, eg `$1` becomes `(?<__1>LITERAL_REGEX_STRING)`.
			result = result.replace(match, createNamedLiteralRegex(`${literalPrefix}${match.replace('$', '')}`))
			encounteredLiterals.add(match);
		}
	}

	return result;
}

// Converts code operator matchers such as $@op, $@operator10, etc with regex.
// Handles complex replacements such as repeated operator captures, eg `$@op $a $@op`.
function replaceOperatorsWithRegex(codeString) {
	const captureRegex = /\$@([a-zA-z]+[0-9_]*)/g;
	const matches = codeString.match(captureRegex);
	if (matches == null)
		return codeString;

	const encounteredOperators = new Set();
	let result = codeString;

	for (const match of matches) {
		if (encounteredOperators.has(match)) {
			// Replace match with back reference, eg `$@op` becomes `\k<___op>`.
			result = result.replace(match, `\\k<${operatorPrefix}${match.replace('$@', '')}>`);
		} else {
			// Replace match with literal regex, eg `$@op` becomes `(?<___op>OPERATOR_REGEX_STRING)`.
			result = result.replace(match, createNamedOperatorRegex(`${operatorPrefix}${match.replace('$@', '')}`))
			encounteredOperators.add(match);
		}
	}

	return result;
}

// Converts code keyword matchers such as $#a, $#b, $#keyword1, etc with regex.
// Handles complex replacements such as repeated keyword captures, eg `$#keyword1 { $$ } $#keyword1`.
function replaceKeywordsWithRegex(codeString) {
	const captureRegex = /\$#([a-zA-z]+[0-9_]*)/g;
	const matches = codeString.match(captureRegex);
	if (matches == null)
		return codeString;

	const encounteredKeywords = new Set();
	let result = codeString;

	for (const match of matches) {
		if (encounteredKeywords.has(match)) {
			// Replace match with back reference, eg `$#keyword` becomes `\k<____keyword>`.
			result = result.replace(match, `\\k<${keywordPrefix}${match.replace('$#', '')}>`);
		} else {
			// Replace match with literal regex, eg `$#keyword` becomes `(?<____keyword>KEYWORD_REGEX_STRING)`.
			result = result.replace(match, createNamedKeywordRegex(`${keywordPrefix}${match.replace('$#', '')}`))
			encounteredKeywords.add(match);
		}
	}

	return result;
}
