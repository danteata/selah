import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

export default function IdentifyView() {
    const [searchParams] = useSearchParams()
    const color = searchParams.get('color') || '#3B82F6'
    const name = searchParams.get('name') || 'Display'

    useEffect(() => {
        // Auto-close after 3 seconds using Tauri window API or fallback
        const timer = setTimeout(() => {
            if ((window as any).__TAURI__) {
                import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
                    getCurrentWindow().close().catch(() => window.close())
                })
            } else {
                window.close()
            }
        }, 3000)
        return () => clearTimeout(timer)
    }, [])

    return (
        <div
            style={{
                width: '100vw',
                height: '100vh',
                overflow: 'hidden',
                background: '#000',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                boxShadow: `inset 0 0 0 24px ${color}`,
                margin: 0,
                padding: 0,
            }}
        >
            <div
                style={{
                    padding: '24px 48px',
                    borderRadius: '16px',
                    background: `${color}22`,
                    border: `4px solid ${color}`,
                    color: color,
                    textAlign: 'center',
                    animation: 'pulse 1s ease-in-out infinite alternate',
                }}
            >
                <h1 style={{ fontSize: 'clamp(2rem, 4vw, 4rem)', marginBottom: '8px' }}>{name}</h1>
                <p style={{ fontSize: 'clamp(1rem, 2vw, 1.5rem)', opacity: 0.9 }}>This is your {name}</p>
            </div>
            <style>{`
                @keyframes pulse {
                    from { transform: scale(1); opacity: 1; }
                    to { transform: scale(1.05); opacity: 0.8; }
                }
            `}</style>
        </div>
    )
}