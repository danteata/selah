import { useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import Placeholder from '@tiptap/extension-placeholder'
import { TipTapToolbar } from './TipTapToolbar'

interface TipTapEditorProps {
    content: string
    onChange: (content: string) => void
    placeholder?: string
    editable?: boolean
    font?: string
    alignment?: 'left' | 'center' | 'right'
    className?: string
    onFocus?: () => void
    onBlur?: () => void
}

export function TipTapEditor({
    content,
    onChange,
    placeholder = 'Start typing...',
    editable = true,
    font = 'Inter',
    alignment = 'center',
    className = '',
    onFocus,
    onBlur,
}: TipTapEditorProps) {
    const previousContentRef = useRef(content)

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: {
                    levels: [1, 2, 3],
                },
            }),
            TextAlign.configure({
                types: ['heading', 'paragraph'],
            }),
            Highlight.configure({
                multicolor: true,
            }),
            TextStyle,
            FontFamily.configure({
                types: ['textStyle'],
            }),
            Color.configure({
                types: ['textStyle'],
            }),
            Placeholder.configure({
                placeholder,
                showOnlyWhenEditable: true,
                emptyEditorClass: 'is-editor-empty',
            }),
        ],
        content,
        editable,
        onUpdate: ({ editor }) => {
            const html = editor.getHTML()
            if (html !== previousContentRef.current) {
                previousContentRef.current = html
                onChange(html)
            }
        },
        onFocus: () => {
            onFocus?.()
        },
        onBlur: () => {
            onBlur?.()
        },
        editorProps: {
            attributes: {
                class: `prose prose-slate dark:prose-invert max-w-none focus:outline-none min-h-[80px] p-3 ${className}`,
                style: `font-family: ${font}; text-align: ${alignment};`,
            },
        },
    })

    // Update content when prop changes externally
    useEffect(() => {
        if (editor && content !== previousContentRef.current) {
            editor.commands.setContent(content, { emitUpdate: false })
            previousContentRef.current = content
        }
    }, [editor, content])

    // Update font family
    useEffect(() => {
        if (editor) {
            editor.chain().setFontFamily(font).run()
        }
    }, [editor, font])

    // Update alignment
    useEffect(() => {
        if (editor) {
            editor.chain().focus().setTextAlign(alignment).run()
        }
    }, [editor, alignment])

    // Update editable state
    useEffect(() => {
        if (editor) {
            editor.setEditable(editable)
        }
    }, [editor, editable])

    if (!editor) {
        return (
            <div className="flex items-center justify-center min-h-[80px] p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
                <div className="w-4 h-4 border-2 border-primary-500/20 border-t-primary-500 rounded-full animate-spin" />
            </div>
        )
    }

    return (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-800">
            {editable && <TipTapToolbar editor={editor} />}
            <EditorContent editor={editor} />
        </div>
    )
}

// Simple inline editor without toolbar (for live output)
export function TipTapInlineEditor({
    content,
    onChange,
    placeholder = 'Start typing...',
    editable = true,
    font = 'Inter',
    alignment = 'center',
    className = '',
}: TipTapEditorProps) {
    const previousContentRef = useRef(content)

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: {
                    levels: [1, 2, 3],
                },
            }),
            TextAlign.configure({
                types: ['heading', 'paragraph'],
            }),
            TextStyle,
            FontFamily.configure({
                types: ['textStyle'],
            }),
            Color.configure({
                types: ['textStyle'],
            }),
            Placeholder.configure({
                placeholder,
                showOnlyWhenEditable: true,
                emptyEditorClass: 'is-editor-empty',
            }),
        ],
        content,
        editable,
        onUpdate: ({ editor }) => {
            const html = editor.getHTML()
            if (html !== previousContentRef.current) {
                previousContentRef.current = html
                onChange?.(html)
            }
        },
        editorProps: {
            attributes: {
                class: `prose prose-slate dark:prose-invert max-w-none focus:outline-none ${className}`,
                style: `font-family: ${font}; text-align: ${alignment};`,
            },
        },
    })

    // Update content when prop changes externally
    useEffect(() => {
        if (editor && content !== previousContentRef.current) {
            editor.commands.setContent(content, { emitUpdate: false })
            previousContentRef.current = content
        }
    }, [editor, content])

    // Update font family
    useEffect(() => {
        if (editor) {
            editor.chain().setFontFamily(font).run()
        }
    }, [editor, font])

    // Update alignment
    useEffect(() => {
        if (editor) {
            editor.chain().focus().setTextAlign(alignment).run()
        }
    }, [editor, alignment])

    if (!editor) {
        return null
    }

    return <EditorContent editor={editor} />
}

export default TipTapEditor