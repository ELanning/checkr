import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import { code, escapeRegExp } from './code';

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

				// 'boundUnderline' is passed again as a second arg for backwards compatibility.
				check({ ...file, fs, path, child_process, code, underline: boundUnderline }, boundUnderline);
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

// `warn` and `warning` are both supported for us with bad memories.
// Yes, I know it makes the code less beautiful and possibly more inconsistent.
type AlertLevel = 'info' | 'warn' | 'warning' | 'error';

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
	} else if (alert === 'warn' || alert === 'warning') {
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
