// VAD Loader - Loads onnxruntime-web and VAD bundle from CDN
// This avoids bundling issues with Vite

(function () {
    // Load onnxruntime-web from CDN
    var ortScript = document.createElement('script');
    ortScript.src = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.js';
    ortScript.type = 'text/javascript';

    ortScript.onload = function () {
        console.log('[VAD Loader] onnxruntime-web loaded from CDN');

        // Now load the VAD bundle from CDN
        var vadScript = document.createElement('script');
        vadScript.src = 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.29/dist/bundle.min.js';
        vadScript.type = 'text/javascript';

        vadScript.onload = function () {
            console.log('[VAD Loader] VAD bundle loaded from CDN');

            // The VAD bundle exports to window.vad when ort is available
            if (typeof window.vad !== 'undefined') {
                console.log('[VAD Loader] VAD ready, MicVAD available:', !!window.vad.MicVAD);
            } else {
                console.error('[VAD Loader] VAD bundle did not export to window.vad');
            }
        };

        vadScript.onerror = function () {
            console.error('[VAD Loader] Failed to load VAD bundle from CDN');
        };

        document.head.appendChild(vadScript);
    };

    ortScript.onerror = function () {
        console.error('[VAD Loader] Failed to load onnxruntime-web from CDN');
    };

    document.head.appendChild(ortScript);
})();
