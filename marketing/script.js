document.querySelectorAll('[data-copy]').forEach((button) => {
	const label = button.querySelector('.btn-label');
	if (!label) return;
	const defaultText = label.textContent;

	button.addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText(button.getAttribute('data-copy'));
		} catch {
			return;
		}

		label.textContent = 'Copied';
		setTimeout(() => {
			label.textContent = defaultText;
		}, 1500);
	});
});

document.querySelectorAll('img.screenshot').forEach((img) => {
	img.addEventListener('error', () => img.remove(), { once: true });
});
