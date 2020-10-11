[
    // List of checkr.js examples.
    function noPrefixPlusPlus({ fileExtension }, underline) {
        if (fileExtension !== "js" && fileExtension !== 'jsx') {
            return;
        }

        const prefixPlusPlus = /\+\+[a-zA-Z]+/g;
        underline(prefixPlusPlus, "Prefer a++ over ++a.", "info");
    },

    function deprecateSetDocuments({ fileExtension }, underline) {
        if (fileExtension !== "js" && fileExtension !== 'jsx') {
            return;
        }

        underline("setDocuments", "[Deprecated] prefer setUserDocuments.", "warn");
    },

    function missingJsxReturn({fileExtension, fileContents}, underline) {
        if (fileExtension !== 'jsx') {
            return;
        }
        
        /*
        * Naive implementation to catch unreturned JSX:
        * function foobar() {
        *   <div>Hello World</div>; // Uh-oh missing "return"
        * }
        * For demonstration purposes only.
        */
        const naiveFunctionCapture = /function .+ {[\s\S]+?}/g;
        const limit = 50;
        let counter = 0; // Counter to mitigate excessive backtracking cases.
        let match;
        
        while ((match = naiveFunctionCapture.exec(fileContents)) != null) {
            counter++;
            if (counter > limit) {
                break;
            }
    
            const matchSubstring = match[0];
            const containsJsx = matchSubstring.match(/<.+>/g).length !== 0;
            const containsReturn = matchSubstring.includes('return');
            const missingJsxReturn = !containsReturn && containsJsx;
            if (missingJsxReturn) {
                underline(matchSubstring, "Missing 'return' in JSX function.", "error");
            }
        }                
    },
];