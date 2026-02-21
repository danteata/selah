declare module 'sql.js' {
    interface SqlJsStatic {
        Database: new (data?: ArrayLike<number>) => Database
    }

    interface Database {
        run(sql: string, params?: unknown[]): Database
        exec(sql: string): QueryExecResult[]
        close(): void
    }

    interface QueryExecResult {
        columns: string[]
        values: unknown[][]
    }

    export default function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>
    export { initSqlJs }
}
