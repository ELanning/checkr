const code = require('../out/code.js').code;

// Test utils.
function assert(condition) {
	if (!condition) {
		throw new Error();
	}
}

function assertMatch(regex, str) {
	if (!regex.test(str)) {
		throw new Error(`"${regex}" did not match:\n"${str}"`);
	}
}

function assertNotMatch(regex, str) {
	if (regex.test(str)) {
		throw new Error(`"${regex}" did match:\n"${str}"`);
	}
}

// Test "escape hatch" regex.
assertMatch(code`5 + 5REGEX(3+)`, `5+53`);
assertMatch(code`REGEX(3+9+2*) 5 + 5`, `392225+53`);

// Test complicated matching
assertMatch(
	code`$#keyword ($1 $@ops1 $a) { return $a $@ops2 $2; }`,
	`
while (undefined === lineMatch) {
	return lineMatch / 55;
}`,
);

assertMatch(code`$#keyword($1$@ops1$2) { $$$ $1 $@ops1 $2 }`, `do(55 + "333") {55 + "333"}`);

// Test anonymous operator and keyword matching.
assertMatch(code`$# ($a$@$a) { $1$@$2; }`, `while (a==a) { 1 / 2; }`);

// Test overlapping symbols, eg `+` in javascript vs `+` in regex.
assertMatch(code`5+5*2`, `5 + 5 * 2`);

// Disallow assignment operators in conditional expressions.
assertMatch(code`$$ ? $a = $b : $$`, `foobar ? var1 = var2 : 5`);
assertMatch(code`$$ ? $$ : $a = $b`, `bazBar() ? bop() : foo = bar`);
assertNotMatch(code`$$ ? $a = $b : $$`, `foobar ? getFunc() : baz`);

// Disallow constant expressions in conditions.
assertMatch(code`if ($1$@op$2)`, `if (5+5)`);
assertMatch(code`if ($1 $@op $2)`, `if (""+3.02)`);
assertMatch(code`if ($1)`, `if(true)`);

// Disallow duplicate arguments in `function` definitions.
assertMatch(code`function $a($b $$ $b)`, `function useFoo(first, second, first)`);
assertNotMatch(code`function $a($b $$ $b)`, `function useFoo(first, second, third)`);

// Disallow duplicate case labels.
assertMatch(
	code`
case $1:
	$$
case $1:
`,
	'case 5: console.log(333) break; case 5: break;',
);
assertNotMatch(
	code`
case $1:
	$$
case $1:
`,
	'case 5: console.log(333) break; case 55: break;',
);

// Disallow reassigning exceptions in `catch` clauses.
assertMatch(code`catch ($e) { $e = $$ }`, 'catch (e) { e = getError(); }');
assertNotMatch(code`catch ($e) { $e = $$ }`, 'catch (e) { throw e; }');

// Disallow returning values from setters.
assertMatch(
	code`set $a($$) { $$ return $$; }`,
	`set current(name) { console.log(name); return name; }`,
);
assertNotMatch(code`set $a($$) { $$ return $$; }`, `set current(name) { console.log(name); }`);

// Disallow returning values from Promise executor functions.
assertMatch(
	code`
new Promise($$ => {
	$$ return $$; $$
});
`,
	`
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
`,
);

// Enforce a maximum depth that blocks can be nested.
assertMatch(
	code`
{$$
	{$$
		{$$
			{
				$$
			}
		$$}
	$$}
$$}`,
	`
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
}`,
);
assertNotMatch(
	code`
{$$
	{$$
		{$$
			{
				$$
			}
		$$}
	$$}
$$}`,
	`
{
	if (a == b) {
		return true;
	}
}`,
);

// Enforce consistent naming for boolean props.
assertMatch(
	code`$a: PropTypes.bool$$`,
	`
MyComponent.propTypes = {
	optionalBool: PropTypes.bool,
	bazBar: PropTypes.number,
};`,
);

// Prevent usage of button elements without an explicit type attribute.
testRequireTypeAttribute();
function testRequireTypeAttribute() {
	const sampleCodeBlock = `
<button type="button">Hello world.</button>
<button type="clickityClacker">Hello world.</button>
<button>Hello world.</button>`;

	const checkIsValid = (match) => match.blocks.every((x) => x.includes('type='));
	const validButtonCount = code`<button $$>`.matchAll(sampleCodeBlock).filter(checkIsValid).length;

	assert(validButtonCount === 2);
}

// Enforce consistent usage of destructuring assignment of props, state, and context.
testRequirePropDestructing();
function testRequirePropDestructing() {
	const sampleCodeBlock = `
function ValidReactComponent(props, context) {
	const { propOne, propTwo, propThree } = props;
	return <div>{propOne + propTwo + propThree}</div>;
}
function InvalidReactComponent(props) {
	return <div>{props.propOne + props.propTwo}</div>;
}`;

	const checkIsValid = (match) => match.blocks.some((x) => x.includes('= props;'));
	const validComponentCount = code`function $a($$ props $$) { $$$ }`
		.matchAll(sampleCodeBlock)
		.filter(checkIsValid).length;

	assert(validComponentCount === 1);
}

// Exported classes must end with `View`.
assertMatch(
	code`export function $a View($$) { $$$ }`,
	`
export function HomepageView(props, context) {
	const { propOne, propTwo, propThree } = props;
	return <div>{propOne + propTwo + propThree}</div>;
}`,
);
assertNotMatch(
	code`export function $a View($$) { $$$ }`,
	`
export function Account(props) {
	return <div>{props.propOne + props.propTwo}</div>;
}`,
);

// Enforce all defaultProps have a corresponding non-required PropType.
assertMatch(
	code`propTypes = {$$ $a: $$.isRequired $$} $$ defaultProps = { $$ $a: $$ }`,
	`
class Greeting extends React.Component {
	render() {
	  return (
		<h1>Hello, {this.props.foo} {this.props.bar}</h1>
	  );
	}
  
	static propTypes = {
	  foo: React.PropTypes.string,
	  bar: React.PropTypes.string.isRequired
	};
  
	static defaultProps = {
	  bar: "baz"
	};
}`,
);

// Prevent missing displayName in a React component definition.
testDisplayNameOnComponents();
function testDisplayNameOnComponents() {
	const sampleCodeBlock = `
export function HomepageView(props, context) {
	const { propOne, propTwo, propThree } = props;
	return <div>{propOne + propTwo + propThree}</div>;
}
HomepageView.displayName = "HomepageView";

export function Account(props) {
	return <div>{props.propOne + props.propTwo}</div>;
}`;

	const checkIsValid = (match) =>
		match.variables.every((x) => {
			const isReactComponent = /[A-Z]/.test(x[0]);
			const hasDisplayName = code`${x}.displayName =`.matchAll(sampleCodeBlock).length !== 0;
			return isReactComponent && hasDisplayName;
		});
	const validDisplayNameCount = code`export function $a($$) { $$ }`
		.matchAll(sampleCodeBlock)
		.filter(checkIsValid).length;

	assert(validDisplayNameCount === 1);
}

// Forbid certain props on Components (eg forbid className).
testForbidCertainProps();
function testForbidCertainProps() {
	const sampleCodeBlock = `
function FoobarComponent(props) {
	return <BigHeader className="veryCool" />;
}

function BazComponent(props) {
	return <div className="evenCooler" />;
}`;

	const checkIsValid = (match) =>
		match.variables.every((x) => {
			const isReactComponent = /[A-Z]/.test(x[0]);
			return !isReactComponent;
		});
	const validComponentCount = code`function $$($$) { $$ <$a className=$$ }`
		.matchAll(sampleCodeBlock)
		.filter(checkIsValid).length;

	assert(validComponentCount === 1);
}

// Forbid certain elements (eg forbid `button`, prefer `Button`).
assertMatch(code`<button $$>`, `<Button isValid /><button />`);
assertNotMatch(code`<button $$>`, `<Button isValid />`);

// Prevent using this.state within a this.setState (eg use prevState).
assertMatch(
	code`this.setState($$ this.state $$)`,
	`this.setState({ x: this.state.x, bar: this.state.bar });`,
);
assertNotMatch(
	code`this.setState($$ this.state $$)`,
	`this.setState(prevState => { x: prevState.x, bar: prevState.bar });`,
);

// Prevent problem with children and props.dangerouslySetInnerHTML.
assertMatch(
	code`<$$ dangerouslySetInnerHtml=$$>$$</$$>`,
	`<div dangerouslySetInnerHtml={foo} title="bar"><button /></div>`,
);
assertNotMatch(
	code`<$$ dangerouslySetInnerHtml=$$>$$</$$>`,
	`<div dangerouslySetInnerHtml={foo} title="bar" />`,
);

// Enforce a defaultProps definition for every prop that is not a required prop.
testDefaultPropsForNonrequired();
function testDefaultPropsForNonrequired() {
	const sampleCodeBlock = `
// Valid.
function FoobarComponent(props) {
	return <BigHeader className="veryCool" />;
}
FoobarComponent.propTypes = {
	title: PropTypes.string,
};
FoobarComponent.defaultProps = {
	title: "This is a sensible default.",
};

// Not valid.
function BazComponent(props) {
	return <div className="evenCooler" />;
}
BazComponent.propTypes = {
	title: PropTypes.string,
};
BazComponent.defaultProps = {
	header: "Drink Ovaltine.",
};
`;

	const checkIsValid = (match) => {
		const propTypes = match.blocks[3];
		const defaultProps = match.blocks[5];

		const nonrequiredProps = code`$a: $$`
			.matchAll(propTypes)
			.filter((x) => !x.blocks[0].includes('isRequired'))
			.map((x) => x.variables)
			.flat();
		const defaults = code`$a: $$`
			.matchAll(defaultProps)
			.filter((x) => x.variables.every((variable) => nonrequiredProps.includes(variable)));

		return nonrequiredProps.length === defaults.length;
	};
	const validComponentCount =
		code`function $a($$) { $$ } $$ $a.propTypes = { $$ } $$ $a.defaultProps = { $$ }`
			.matchAll(sampleCodeBlock)
			.filter(checkIsValid).length;

	assert(validComponentCount === 1);
}

// Enforce PascalCase for user-defined JSX components.
testEnforcePascalCase();
function testEnforcePascalCase() {
	const sampleCodeBlock = `
// Valid.
function FoobarComponent(props) {
	return <BigHeader className="veryCool" />;
}
function CoolComponent(props) {
	return (<BigHeader className="veryCool">Not bad!</BigHeader>);
}


// Not valid.
function notPascalCase(props) {
	return <div>Hello world</div>;
}
function NOTPASCALCASE(props) {
	return <div>Hello world</div>;
}`;

	const checkIsValid = (match) =>
		match.variables.every((x) => {
			const startsWithUpper = /[A-Z]/.test(x[0]);
			const followedByNoneOrNonupper = x.length === 1 ? true : !/[A-Z]/.test(x[1]);
			return startsWithUpper && followedByNoneOrNonupper;
		});
	const validComponentCount = code`function $a($$) { $$<$$ }`
		.matchAll(sampleCodeBlock)
		.filter(checkIsValid).length;

	assert(validComponentCount === 2);
}

// Enforce defaultProps declarations alphabetical sorting.
testEnforceDefaultPropOrdering();
function testEnforceDefaultPropOrdering() {
	const sampleCodeBlock = `
// Valid.
function FoobarComponent(props) {
	return <BigHeader className="veryCool" />;
}
FoobarComponent.defaultProps = {
	a: "a",
	b: "b",
	c: "c",
	d: "d",
};

// Not valid.
function BazComponent(props) {
	return <div className="evenCooler" />;
}
BazComponent.defaultProps = {
	c: "c",
	b: "b",
	a: "a",
	d: "d",
};
`;

	const checkIsValid = (match) => {
		const defaultProps = match.blocks[match.blocks.length - 1];
		const defaults = code`$a: $$`.matchAll(defaultProps).flatMap((x) => x.variables);
		const sortedDefaults = [...defaults].sort();
		return defaults.every((variable, i) => variable === sortedDefaults[i]);
	};
	const validComponentCount = code`function $a($$) { $$ } $$ $a.defaultProps = { $$ }`
		.matchAll(sampleCodeBlock)
		.filter(checkIsValid).length;

	assert(validComponentCount === 1);
}

// Prevent usage of unsafe target='_blank'.
testCatchUnsafeTargetBlank();
function testCatchUnsafeTargetBlank() {
	const sampleCodeBlock = `
const Valid1 = <a target='_blank' rel="noreferrer" href="http://example.com"></a>;
const Valid2 = <a target='_blank' rel="noopener noreferrer" href="http://example.com"></a>;

const Invalid1 = <a target='_blank' href="http://example.com/"></a>;
const Invalid2 = <a target='_blank' href={dynamicLink}></a>;`;

	const checkIsValid = (match) => match.blocks.some((x) => x.includes('noreferrer'));
	const validComponentCount = code`<a $$ target='_blank' $$>`
		.matchAll(sampleCodeBlock)
		.filter(checkIsValid).length;

	assert(validComponentCount === 2);
}

// Enforce event handler naming conventions in JSX.
testEnforceHandlerConvention();
function testEnforceHandlerConvention() {
	const sampleCodeBlock = `
// Valid.
<MyComponent onChange={this.handleChange} />
<MyComponent onChange={this.props.onFoo} />

// Invalid.
<InvalidOne handleChange={this.handleChange} />
<InvalidTwo onChange={this.componentChanged} />`;

	const checkIsValid = (match) => {
		const pieces = match.blocks[1].split('.');
		const variableName = pieces[pieces.length - 1];
		return variableName.startsWith('handle') || variableName.startsWith('on');
	};
	const validHandlerPropNameCount = code`<$a on$$={$$} $$>`
		.matchAll(sampleCodeBlock)
		.filter(checkIsValid).length;

	assert(validHandlerPropNameCount === 2);
}

// Prevent duplicate properties in JSX.
assertMatch(
	code`<$$ $a=$$ $$ $a=$$`,
	`<Button onClick={this.handleClick} text="Hello" onClick={this.deleteUser} />`,
);
assertNotMatch(code`<$$ $a=$$ $$ $a=$$`, `<Button onClick={this.handleClick} text="Hello"/>`);
