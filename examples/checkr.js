[
    function requirePropDestructing({ fileContents, underline, code }) {
		const underlineComponents = (match) => {
			if (!match.blocks[2].includes('= props;'))
				underline(code`${match.variables[0]}($$ props $$)`, "❌ `props` must be destructed.", "error");
		};

		code`function $a($$ props $$) { $$$ }`
			.matchAll(fileContents)
			.forEach(underlineComponents);
	},

	function requireButtonTypeAttribute({ fileContents, underline, code }) {
		const underlineInvalidButtons = (match) => match
			.blocks
			.filter((x) => !x.includes('type='))
			.forEach(x => underline(x, "⚠️ `type` should be on buttons.", "warn"));

		code`<button $$>`
			.matchAll(fileContents)
			.forEach(underlineInvalidButtons);
	},

	function enforceBooleanPropNaming({ fileContents, underline, code }) {
		code`$a: PropTypes.bool$$`
			.matchAll(fileContents)
			.forEach(match => {
				const is = match.variables[0].startsWith("is");
				const has = match.variables[0].startsWith("has");
				const should = match.variables[0].startsWith("should");
				const isRecommended = is || has || should;
				if (!isRecommended)
					underline(code`${match.variables[0]}: PropTypes.bool$$`, "💬 Consider prefix with 'is', 'has', or 'should'.", "info");
			});
	}
];