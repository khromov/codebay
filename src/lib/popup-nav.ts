const POPUP_PARAM = 'popup';

/** Assumes `href` has no existing query string. */
export function withPopupMarker(href: string): string {
	return `${href}?${POPUP_PARAM}=1`;
}

export function isPopupPage(): boolean {
	return new URLSearchParams(location.search).has(POPUP_PARAM);
}

function closeOrGoHome() {
	window.close();
	// Runs only if close() was refused (tab wasn't opened by script) — window.close()
	// tears the page down near-instantly when it succeeds, so this never fires then.
	setTimeout(() => {
		location.href = '/';
	}, 100);
}

export function onBackLinkClick(e: MouseEvent) {
	if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
		return;
	if (!isPopupPage()) return;
	e.preventDefault();
	closeOrGoHome();
}

export function installPopupBackTrap(): () => void {
	if (!isPopupPage()) return () => {};
	// A fresh popup tab has one history entry, so back is otherwise a no-op the
	// browser just disables — push a duplicate so the first back press fires popstate.
	history.pushState({}, '', location.href);
	const onPop = () => closeOrGoHome();
	window.addEventListener('popstate', onPop);
	return () => window.removeEventListener('popstate', onPop);
}
