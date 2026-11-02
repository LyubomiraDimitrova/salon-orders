export function createHeader() {
  const header = document.createElement('header');
  header.className = 'site-header border-bottom';
  header.innerHTML = `
    <nav class="navbar navbar-expand-lg navbar-light py-3" aria-label="Основна навигация">
      <div class="container">
        <a class="navbar-brand fw-bold fs-4" href="/" aria-label="Salon Orders — начало">
          Salon <span>Orders</span>
        </a>
        <button
          class="navbar-toggler"
          type="button"
          data-bs-toggle="collapse"
          data-bs-target="#mainNavigation"
          aria-controls="mainNavigation"
          aria-expanded="false"
          aria-label="Отвори навигацията"
        >
          <span class="navbar-toggler-icon"></span>
        </button>
        <div id="mainNavigation" class="collapse navbar-collapse">
          <ul class="navbar-nav ms-auto align-items-lg-center gap-lg-2">
            <li class="nav-item"><a class="nav-link active" aria-current="page" href="/">Начало</a></li>
            <li class="nav-item"><span class="nav-link text-body-secondary">Каталог</span></li>
            <li class="nav-item"><span class="nav-link text-body-secondary">За салона</span></li>
          </ul>
        </div>
      </div>
    </nav>
  `;

  return header;
}
