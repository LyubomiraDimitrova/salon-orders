export function createFooter() {
  const footer = document.createElement('footer');
  footer.className = 'site-footer py-4';
  footer.innerHTML = `
    <div class="container d-flex flex-column flex-md-row justify-content-between align-items-md-center gap-2">
      <p class="mb-0">&copy; ${new Date().getFullYear()} Salon Orders</p>
      <p class="mb-0 text-body-secondary">Професионална грижа, избрана за вас.</p>
    </div>
  `;

  return footer;
}
