// The app's stylesheets, so goldens render with the real fonts and Tailwind
// classes rather than browser defaults.
import '../../styles/slide-fonts.css'
import '../../index.css'

// No caret blink or CSS animation mid-screenshot: a golden has to be one frame.
const freeze = document.createElement('style')
freeze.textContent = `*, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
}`
document.head.appendChild(freeze)
