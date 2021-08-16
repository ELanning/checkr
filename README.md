# checkr vs-code extension + git hook 🔍

**Write lint rules fast.**

```javascript
[
	// Underline non-alphabetically ordered default props.
	function checkDefaultPropOrder({ fileContents, underline, code }) {
		const underlineUnsorted = (match) => {
			const defaultProps = match.blocks[match.blocks.length - 1];
			const defaults = code`$a: $$`.matchAll(defaultProps).flatMap((x) => x.variables);
			const sortedDefaults = [...defaults].sort();
			if (!defaults.every((variable, i) => variable === sortedDefaults[i])) {
				underline(defaultProps, '⚠️ Default props must be alphabetically sorted.', 'warn');
			}
		};

		code`function $a($$) { $$ } $$ $a.defaultProps = { $$ }`
			.matchAll(fileContents)
			.forEach(underlineUnsorted);
	},
];
```

![Screenshot in action](demo.png)

## Installation

### Extension

Search for "checkr" in the VS Code extensions tab (Ctrl+Shift+X to open).

### Pre-commit hook

1. Copy [checkr-hook.js](./checkr-hook.js) into the project's hook folder (typically `/hooks`).
2. Install [husky](https://github.com/typicode/husky) with `npm install husky --save-dev`
3. Setup `package.json` with

```json
"scripts": {
  "hooks:pre-commit": "node ./hooks/checkr-hook.js",
},
"husky": {
  "pre-commit": "npm run hooks:pre-commit",
},
```

That's it!

## Why

Linting is a powerful tool for enforcing project consistency and finding common issues. Many tools such as [ESLint](https://eslint.org/), [JSHint](https://jshint.com/), and others exist for this purpose. However, they do not have project specific rules, and writing a [custom eslint-rule](https://eslint.org/docs/developer-guide/working-with-rules) requires more setup and prior knowledge than a `checkr.js` file.

A checkr rule can result in less code review nits and catch entire classes of bugs that code itself cannot.

## How

On file save and open, checkr looks for a `checkr.js` file in the current directory and iterates up to the root, applying any other `checkr.js` files along the way.

This means you can put global checks in the project root `checkr.js` file, but also have directory specific checks. For example `tests/checkr.js` only applies to files in the `tests` folder and its subdirectories.

A `checkr.js` file should contain a single array of functions to run on file save and open.

Each function is passed the `file` being saved or opened, a function to `underline` code, a function to find `code`, and a set of `utils`.

```typescript
params {
    fileName: string,       // Eg "fooUtil".
    fileExtension: string,  // Eg "js", "css", the empty string, etc.
    fileContents: string,   // Eg "console.log('In fooUtil.js file!')".
    filePath: string,       // Eg "C:\code\cool_project".
    underline: (
      regexOrText: RegExp | string, // Eg /foo*bar/g or an exact string to match, such as "foobar".
      hoverMessage: string,         // Eg "Prefer bar".
      alert?: "error" | "warning" | "info"
    ) => void,
    code: (string: string, ...expressions: string[]) => RegExp,
    fs: NodeFileModule,                 // Eg fs.readFileSync("C:/foobar.txt");
    path: NodePathModule,               // Eg path.join('/foo', 'bar', 'baz/asdf', 'quux', '..');
    child_process: NodeProcessModule,   // Eg child_process.spawnSync("yarn");
}
```

example `checkr.js` file layout

```javascript
[
    function check1({ fileContents, underline, code }) { ... },
    function check2({ fileContents, fileExtension, underline, fs }) { ... },
    function check3({ fileContents, fileName, underline, code }) { ... },
]
```

## `code` Tutorial

`code` translates a simple "code finding syntax" into a `RegExp` which can be used to `underline` things.

## Examples

```javascript
// TODO.
```

## Best Practices

- Verify an ESLint rule for the problem doesn't already exist.
- Prefer writing a custom ESLint rule for complicated checks.
- Avoid solving problems with linters that may be better handled with other methods.
- Prefer checks that are actionable and accurate over 90% of the time.

[More best practices here.](https://cacm.acm.org/magazines/2018/4/226371-lessons-from-building-static-analysis-tools-at-google/fulltext)  
[Test regex patterns here.](https://www.regextester.com)

## Contributing

All improvements are welcome. When opening a PR or updating the wiki feel free to add your name to the [contributors.md](contributors.md) and an emoji if you'd like, so your name can be immortalized until the end of time!

Feel free to take any ideas or invent your own:

- `import` support in `checkr.js` files.
- Adding useful checks to the `examples/` folder.
- More options to run at intervals or on other events.
- Optimizations such as file caching.

To debug the extension:

1.  `git clone` the repo.
1.  Install `yarn` and run in it the project root. See `package.json` for a full list of commands.
1.  Run `yarn watch` to compile the TypeScript into JavaScript and "watch" for any file changes.
1.  Open the project in VS code, and press `F5`.
1.  `Ctrl+R` in the debug window reloads the extension.

## Contact

cs@eriklanning.com
