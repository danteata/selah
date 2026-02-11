import { useEffect, useCallback } from 'react';
import mitt from 'mitt';
import type { Emitter, EventType, Handler } from 'mitt';
import { useAppStore } from '../store/appStore';

export type AppEvents = Record<EventType, unknown>;

// Create a single global emitter instance
const globalEmitter = mitt<AppEvents>();

export function useEmitter() {
    const storeEmitter = useAppStore((state) => state.emitter);
    const setEmitter = useAppStore((state) => state.setEmitter);

    // Set the global emitter in the store if not already set
    useEffect(() => {
        if (!storeEmitter) {
            setEmitter(globalEmitter);
        }
    }, [storeEmitter, setEmitter]);

    const on = useCallback(<T = unknown>(type: EventType, handler: Handler<T>): (() => void) => {
        const typedHandler = handler as Handler<unknown>;
        globalEmitter.on(type, typedHandler);
        return () => {
            globalEmitter.off(type, typedHandler);
        };
    }, []);

    const off = useCallback(<T = unknown>(type: EventType, handler: Handler<T>) => {
        globalEmitter.off(type, handler as Handler<unknown>);
    }, []);

    const emit = useCallback(<T = unknown>(type: EventType, event?: T) => {
        console.log('[Emitter] Emitting:', type, event);
        globalEmitter.emit(type, event as unknown);
    }, []);

    return {
        on,
        off,
        emit,
        emitter: globalEmitter,
    };
}

// Hook for listening to specific events
export function useEvent<T = unknown>(
    eventName: string,
    handler: (data: T) => void,
    deps: React.DependencyList = []
) {
    const { on } = useEmitter();

    useEffect(() => {
        const unsubscribe = on(eventName, handler);
        return () => {
            unsubscribe?.();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eventName, on, ...deps]);
}

// Global emit function for use outside components
export function useGlobalEmit() {
    return useCallback(<T = unknown>(type: string, data?: T) => {
        console.log('[GlobalEmit] Emitting:', type, data);
        globalEmitter.emit(type, data as unknown);
    }, []);
}

// Initialize global emitter (call once at app start)
export function initGlobalEmitter() {
    return globalEmitter;
}

// Direct access to emitter for components
export { globalEmitter };
