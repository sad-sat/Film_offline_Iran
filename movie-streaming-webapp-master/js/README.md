# Streaming Web Application JavaScript Layer

## Overview
Client-side JavaScript modules handling media streaming interactions, catalog data retrieval, JWPlayer video playback, DOM rendering, and client-side Trie-based search autocomplete.

## Interface
- `[movie-review.js:getQueryParams]` Decodes URL search parameters into a key-value object map
- `[movie-review.js:me]` Global object holding active movie query parameters
- `[movie-review.js:storageKey]` Storage key string (`jwplayer.page-reloaded`)
- `[tvshowreview.js:getQueryParams]` Decodes URL search parameters for TV show reviews
- `[tvshowreview.js:me]` Global object holding active TV show query parameters
- `[tvshowreview.js:storageKey]` Storage key string (`jwplayer.page-reloaded`)
- `[triesds.js:TrieNode]` Trie node data structure with key, parent, children, and end marker
- `[triesds.js:TrieNode.prototype.getWord]` Traverses parent links upward to reconstruct word string
- `[triesds.js:Trie]` Trie data structure supporting prefix tree operations
- `[triesds.js:Trie.prototype.insert]` Inserts a title string into the trie
- `[triesds.js:Trie.prototype.find]` Searches matching word prefixes and populates autocomplete options in the DOM
- `[triesds.js:findAllWords]` Subtree traversal collecting matching terminal words
- `[triesds.js:me]` Array of static movie and series titles for search indexing
- `[triesds.js:trie]` Pre-populated global Trie instance
- `[triesds.js:getwords]` Autocomplete input query handler
- [Web Series Catalogs](./web-series/README.md) - Client-side presentation scripts for web series sections

## Invariants
- None

## Side Effects
- `[movielist.js:$.ajax]` Asynchronously fetches `/jsons/test.json` via HTTP GET
- `[movielist.js:$(\"#results\").append]` Injects movie card elements and preview video players into `#results`
- `[movielist.js:videos.forEach]` Attaches hover play/pause and ended event handlers to `.vt` video elements
- `[movielist.js:alert]` Triggers browser alert on AJAX errors
- `[movie-review.js:jwplayer]` Mounts and controls JWPlayer video playback in `#player`
- `[movie-review.js:$(\"#result\").append]` Injects movie details and cast markup into `#result`
- `[searchwebseries.js:$.ajax]` Asynchronously fetches `/jsons/searchwebseries.json` via HTTP GET
- `[searchwebseries.js:$(\"#result\").append]` Injects movie cards into `#result`
- `[searchwebseries.js:$(\"#results\").append]` Injects web series cards into `#results`
- `[searchwebseries.js:videos.forEach]` Attaches hover play/pause event handlers to `.vt` elements
- `[searchwebseries.js:alert]` Triggers browser alert on AJAX errors
- `[triesds.js:trie.insert]` Populates in-memory Trie on script load
- `[triesds.js:document.getElementById(\"datalist\").appendChild]` Mutates `#datalist` by appending matching `<option>` elements
- `[triesds.js:alert]` Triggers alert if search input `#nameValidation` is empty
- `[tvshowreview.js:jwplayer]` Mounts and controls JWPlayer multi-episode video playback in `#player`
- `[tvshowreview.js:$(\"#result\").append]` Injects TV series details and cast markup into `#result`

## Verification
- `<test-command>` (No automated test suite configured for this static webapp directory)
