const code = require('../out/code.js').code;

function assertMatch(regex, str) {
	if (!regex.test(str))
		throw new Error(`"${regex}" did not match:\n"${str}"`);
}

// test overlapping symbols, eg `+` in javascript vs `+` in regex.
assertMatch(code`5+5*2`, `5 + 5 * 2`);

// disallow assignment operators in conditional expressions
assertMatch(code`$$ ? $a = $b : $$`, `foobar ? var1 = var2 : 5`);
assertMatch(code`$$ ? $$ : $a = $b`, `bazBar() ? bop() : foo = bar`);

// disallow constant expressions in conditions
assertMatch(code`if ($1$@op$2)`, `if (5+5)`);
assertMatch(code`if ($1 $@op $2)`, `if (""+3.02)`);
assertMatch(code`if ($1)`, `if(true)`);

// disallow duplicate arguments in `function` definitions
assertMatch(code`function $a($b $$ $b)`, `function useFoo(first, second, first)`);

// disallow duplicate case labels
assertMatch(code`
case $1:
	$$
case $1:
`, "case 5: console.log(333) break; case 5: break;");

// disallow reassigning exceptions in `catch` clauses
assertMatch(code`catch ($e) { $e = $b $$ }`, "catch (e) { e = getError(); }");

// disallow unreachable code after `return`, `throw`, `continue`, and `break` statements
// doesn't handle undefined returns, unfortunately.
assertMatch(code`{ $$$ return $$; $$ }`, `
{
	if (false) {
		return false;
	}

	return true;

	throw Error('unreachable!');
}`)

// disallow returning values from setters
assertMatch(code`set $a($$) { $$ return $$; }`, `set current(name) { console.log(name); return name; }`);

// disallow returning values from Promise executor functions
assertMatch(code`
new Promise($$ => {
	$$ return $$; $$
});
`, `
new Promise((resolve, reject) => {
	if (someCondition) {
		return defaultResult;
	}
	getSomething((err, result) => {
		if (err) {
			reject(err);
		} else {
			resolve(result);
		}
	});
});
`)

// enforce a maximum depth that blocks can be nested
assertMatch(code`
{$$
	{$$
		{$$
			{
				$$
			}
		$$}
	$$}
$$}`, `
{
let x = 5;
{
	let y = 4;
	{
		let z = 10;
		{
			let f = 100.4;
		}
	}
}
}`);

// enforce consistent naming for boolean props
assertMatch(code`$a: PropTypes.bool$$`, `
MyComponent.propTypes = {
	optionalBool: PropTypes.bool,
	bazBar: PropTypes.number,
};
`)

// prevent usage of button elements without an explicit type attribute
assertMatch(code`<button $$>`, `<button>Hello world</button>`)

// enforce consistent usage of destructuring assignment of props, state, and context
assertMatch(code`function $a($$ props $$) { $$ }`, `
function MyComponent(props, context) {
	...	
}
`)
