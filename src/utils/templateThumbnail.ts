const THUMB_WIDTH = 320
const THUMB_HEIGHT = 180

function drawBackgroundToCanvas(
    ctx: CanvasRenderingContext2D,
    background: string,
    backgroundType: string,
    width: number,
    height: number,
): Promise<void> {
    return new Promise((resolve) => {
        if (backgroundType === 'color') {
            ctx.fillStyle = background
            ctx.fillRect(0, 0, width, height)
            resolve()
            return
        }

        if (backgroundType === 'gradient') {
            const parsed = parseLinearGradient(background, width, height)
            if (parsed) {
                const grad = ctx.createLinearGradient(parsed.x0, parsed.y0, parsed.x1, parsed.y1)
                parsed.stops.forEach(([offset, color]: [number, string]) => {
                    grad.addColorStop(offset, color.trim())
                })
                ctx.fillStyle = grad
                ctx.fillRect(0, 0, width, height)
            } else {
                ctx.fillStyle = '#1a1a2e'
                ctx.fillRect(0, 0, width, height)
            }
            resolve()
            return
        }

        if (backgroundType === 'image') {
            const img = new Image()
            img.crossOrigin = 'anonymous'
            img.onload = () => {
                ctx.drawImage(img, 0, 0, width, height)
                resolve()
            }
            img.onerror = () => {
                ctx.fillStyle = '#1a1a2e'
                ctx.fillRect(0, 0, width, height)
                resolve()
            }
            img.src = background
            return
        }

        if (backgroundType === 'video') {
            const video = document.createElement('video')
            video.crossOrigin = 'anonymous'
            video.muted = true
            video.preload = 'metadata'
            let resolved = false
            const finish = (success: boolean) => {
                if (resolved) return
                resolved = true
                if (success) {
                    try {
                        ctx.drawImage(video, 0, 0, width, height)
                    } catch {
                        ctx.fillStyle = '#1a1a2e'
                        ctx.fillRect(0, 0, width, height)
                    }
                } else {
                    ctx.fillStyle = '#1a1a2e'
                    ctx.fillRect(0, 0, width, height)
                }
                video.remove()
                resolve()
            }
            video.onloadeddata = () => {
                video.currentTime = 0
            }
            video.onseeked = () => finish(true)
            video.onerror = () => finish(false)
            setTimeout(() => finish(false), 5000)
            video.src = background
            return
        }

        ctx.fillStyle = '#1a1a2e'
        ctx.fillRect(0, 0, width, height)
        resolve()
    })
}

function parseLinearGradient(
    gradient: string,
    width: number,
    height: number,
): { x0: number; y0: number; x1: number; y1: number; stops: [number, string][] } | null {
    const match = gradient.match(/linear-gradient\(([^,]+),\s*(.+)\)/)
    if (!match) return null

    const direction = match[1].trim()
    const stopsStr = match[2]

    let x0 = 0, y0 = 0, x1 = width, y1 = height
    if (direction.includes('to right')) { y1 = 0 }
    else if (direction.includes('to left')) { x1 = 0; y1 = 0 }
    else if (direction.includes('to bottom')) { x1 = 0; y1 = height }
    else if (direction.includes('to top')) { x0 = 0; y0 = height; x1 = 0; y1 = 0 }
    else if (direction.includes('135deg')) { /* default diagonal */ }
    else if (direction.includes('90deg')) { y1 = 0 }
    else if (direction.includes('180deg')) { x1 = 0; y1 = height }
    else if (direction.includes('270deg')) { x1 = 0; y1 = 0 }
    else if (direction.includes('0deg')) { x0 = 0; y0 = height; x1 = 0; y1 = 0 }

    const stops: [number, string][] = []
    const stopParts = stopsStr.split(/,(?![^()]*\))/)
    stopParts.forEach((part, i) => {
        const trimmed = part.trim()
        const colorMatch = trimmed.match(/^([^ ]+)(?:\s+(\d+)%?)?$/)
        if (colorMatch) {
            const offset = colorMatch[2] ? parseInt(colorMatch[2]) / 100 : i / (stopParts.length - 1 || 1)
            stops.push([offset, colorMatch[1]])
        }
    })

    if (stops.length < 2) return null
    return { x0, y0, x1, y1, stops }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
    const words = text.split(' ')
    const lines: string[] = []
    let currentLine = ''

    for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word
        const metrics = ctx.measureText(testLine)
        if (metrics.width > maxWidth && currentLine) {
            lines.push(currentLine)
            currentLine = word
            if (lines.length >= maxLines) {
                lines[lines.length - 1] = lines[lines.length - 1] + '...'
                return lines
            }
        } else {
            currentLine = testLine
        }
    }

    if (currentLine) {
        if (lines.length >= maxLines) {
            lines[lines.length - 1] = lines[lines.length - 1] + '...'
        } else {
            lines.push(currentLine)
        }
    }

    return lines.slice(0, maxLines)
}

export async function generateThumbnail(
    background: string,
    backgroundType: string,
    content?: string,
): Promise<string> {
    const canvas = document.createElement('canvas')
    canvas.width = THUMB_WIDTH
    canvas.height = THUMB_HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''

    await drawBackgroundToCanvas(ctx, background, backgroundType, THUMB_WIDTH, THUMB_HEIGHT)

    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
    ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT)

    if (content) {
        ctx.fillStyle = 'white'
        ctx.font = 'bold 16px system-ui, -apple-system, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const maxWidth = THUMB_WIDTH - 40
        const lines = wrapText(ctx, content, maxWidth, 2)
        const lineHeight = 20
        const startY = THUMB_HEIGHT / 2 - ((lines.length - 1) * lineHeight) / 2
        lines.forEach((line, i) => {
            ctx.fillText(line, THUMB_WIDTH / 2, startY + i * lineHeight, maxWidth)
        })
    }

    try {
        return canvas.toDataURL('image/png', 0.8)
    } catch {
        return ''
    }
}