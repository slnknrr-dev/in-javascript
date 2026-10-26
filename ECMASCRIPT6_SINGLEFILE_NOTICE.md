# ECMASCRIPT6_SINGLEFILE_NOTICE

The default artifact set of the repository: every snippet below this folder
gets one plain single-file artifact lowered to ES2015 with ES modules
(`es6@mjs/<name>.js`). The name is read as
`ECMASCRIPT6_SINGLEFILE_PLAIN_MJS_NOTICE.md`.

Code that uses node or bun APIs is attempted too: missing built-ins are
polyfilled; what cannot be (for example `node:*` imports) is reported as
`unsupported`.

A folder with its own artifact NOTICE replaces this one for itself and below.
There is no FILES list, so all files are covered. See README_FOR_DEVOPS.md.
