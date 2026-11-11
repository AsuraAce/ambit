import { Result } from '../bindings';

/** helper to unwrap Result<T, E> and throw on error **/
export async function unwrap<T, E>(promise: Promise<Result<T, E>>): Promise<T> {
    const result = await promise;
    if (result.status === "ok") return result.data;
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- throws the Specta command error payload as-is (not an Error instance); callers catch and inspect it
    throw result.error;
}
