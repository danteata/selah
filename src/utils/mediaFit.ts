import { backgroundFillTypes } from '../types'

/** Maps a slide's `backgroundFillType` to the CSS `object-fit` value for an `<img>`/`<video>` element. */
export function getObjectFit(fillType?: string): 'cover' | 'contain' | 'fill' {
    switch (fillType) {
        case backgroundFillTypes.fit: return 'contain'
        case backgroundFillTypes.stretch: return 'fill'
        default: return 'cover'
    }
}

/** Maps a slide's `backgroundFillType` to the CSS `background-size` value for a CSS-background-image element. */
export function getBackgroundSize(fillType?: string): string {
    switch (getObjectFit(fillType)) {
        case 'contain': return 'contain'
        case 'fill': return '100% 100%'
        default: return 'cover'
    }
}
