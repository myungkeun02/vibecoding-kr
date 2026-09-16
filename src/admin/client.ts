const csrf = () => document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || '';
document.addEventListener('submit', async (event) => {
  const form = event.target as HTMLFormElement;
  if (!form.matches('[data-admin-form]')) return;
  event.preventDefault();
  const status = form.querySelector<HTMLElement>('.form-status');
  if (form.dataset.confirm && !confirm(form.dataset.confirm)) return;
  const button = form.querySelector<HTMLButtonElement>('button[type=submit]');
  if (button) button.disabled = true;
  if (status) status.textContent = '처리 중입니다…';
  try {
    const response = await fetch(form.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf() },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '처리하지 못했습니다.');
    if (result.redirect) location.assign(result.redirect);
    else location.reload();
  } catch (error) {
    if (status) {
      status.textContent = (error as Error).message;
      status.classList.add('error');
    }
    if (button) button.disabled = false;
  }
});
for (const select of document.querySelectorAll<HTMLSelectElement>('[data-guide-mode]')) {
  const fieldset = select.closest('details')?.querySelector<HTMLFieldSetElement>('[data-guide-fields]');
  const update = () => {
    if (fieldset) {
      fieldset.hidden = select.value !== 'present';
      fieldset.disabled = select.value !== 'present';
    }
  };
  update();
  select.addEventListener('change', update);
}
for (const controls of document.querySelectorAll<HTMLElement>('[data-service-upload-controls]'))
  controls.hidden = false;
document.addEventListener('change', async (event) => {
  const input = event.target as HTMLInputElement;
  if (!input.matches('[data-service-upload]')) return;
  const form = input.closest('form')!,
    file = input.files?.[0];
  if (!file) return;
  const status = form.querySelector<HTMLElement>('.form-status'),
    body = new FormData();
  body.set('file', file);
  input.disabled = true;
  try {
    const response = await fetch('/api/admin/v1/uploads', {
      method: 'POST',
      headers: { 'x-csrf-token': csrf() },
      body,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    form.querySelector<HTMLInputElement>('input[name=image]')!.value = result.url;
    const image = form.querySelector<HTMLImageElement>('[data-service-image-preview]')!;
    image.src = result.preview;
    image.hidden = false;
    form.querySelector<HTMLButtonElement>('[data-service-image-remove]')!.hidden = false;
  } catch (error) {
    if (status) status.textContent = (error as Error).message;
  } finally {
    input.disabled = false;
  }
});
document.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest('[data-service-image-remove]');
  if (!button) return;
  const form = button.closest('form')!;
  form.querySelector<HTMLInputElement>('input[name=image]')!.value = '';
  form.querySelector<HTMLImageElement>('[data-service-image-preview]')!.hidden = true;
  (button as HTMLElement).hidden = true;
});
