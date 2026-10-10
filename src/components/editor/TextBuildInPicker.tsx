import { Sparkles } from 'lucide-react'
import { TEXT_BUILD_INS, type TextAnimation, type TextBuildInPreset } from '../../lib/animation/textBuildIn'

interface TextBuildInPickerProps {
    value: TextAnimation | undefined
    onChange: (value: TextAnimation | undefined) => void
}

const PRESETS = Object.entries(TEXT_BUILD_INS) as [TextBuildInPreset, (typeof TEXT_BUILD_INS)[TextBuildInPreset]][]

/** How a lower third's text arrives on screen. Shared by the lower-third editor and the template form. */
export function TextBuildInPicker({ value, onChange }: TextBuildInPickerProps) {
    const selected = value?.preset
    const option = (key: string, label: string, desc: string, active: boolean, onClick: () => void) => (
        <button
            key={key}
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={`px-3 py-2 rounded-lg border-2 text-left transition-all ${active
                ? 'border-[var(--accent-teal)] bg-[var(--bg-secondary)]'
                : 'border-[var(--border-subtle)] hover:border-gray-300 dark:hover:border-gray-600'
                }`}
        >
            <span className={`block text-sm font-medium ${active ? 'text-[var(--accent-teal)]' : 'text-[var(--text-primary)]'}`}>
                {label}
            </span>
            <span className="block text-[11px] text-[var(--text-muted)] mt-0.5">{desc}</span>
        </button>
    )

    return (
        <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">
                <Sparkles className="w-3.5 h-3.5 inline mr-1.5" />
                Text Build-in
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {option('none', 'None', 'Appears with the slide', !selected, () => onChange(undefined))}
                {PRESETS.map(([preset, spec]) =>
                    option(preset, spec.label, spec.description, selected === preset, () => onChange({ preset })),
                )}
            </div>
        </div>
    )
}
