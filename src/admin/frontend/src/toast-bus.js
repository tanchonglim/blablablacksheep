export const toastEvent = new EventTarget();

export function showToast(message, type = 'success') {
    toastEvent.dispatchEvent(new CustomEvent('toast', { detail: { message, type, id: Date.now() } }));
}
