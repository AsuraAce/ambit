import { Result } from '../bindings';

/** helper to unwrap Result<T, E> and throw on error **/
export async function unwrap<T, E>(promise: Promise<Result<T, E>>): Promise<T> {
    const result = await promise;
    if (result.status === "ok") return result.data;
    throw result.error;
}
