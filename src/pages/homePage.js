export function createHomePage() {
  const main = document.createElement('main');
  main.innerHTML = `
    <section class="hero-section py-5 py-lg-6">
      <div class="container py-lg-4">
        <div class="row align-items-center g-5">
          <div class="col-lg-7">
            <p class="eyebrow mb-3">ЗА ВАШАТА КОСА</p>
            <h1 class="display-4 fw-bold mb-4">Професионална грижа, подбрана с внимание.</h1>
            <p class="lead text-body-secondary mb-4">
              Открийте продукти за ежедневна грижа и салонни резултати — на едно спокойно и удобно място.
            </p>
            <a class="btn btn-primary btn-lg px-4" href="#welcome">Разгледайте колекцията</a>
          </div>
          <div class="col-lg-5">
            <div class="hero-card p-4 p-md-5">
              <p class="eyebrow mb-3">SALON ORDERS</p>
              <p class="h3 fw-semibold mb-3">Красотата започва с добра грижа.</p>
              <p class="mb-0 text-body-secondary">Скоро ще можете да разглеждате внимателно подбран каталог за вашия тип коса.</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section id="welcome" class="py-5 bg-white">
      <div class="container">
        <div class="row g-4">
          <div class="col-md-4">
            <article class="feature-card h-100 p-4">
              <h2 class="h4">Подбран каталог</h2>
              <p class="mb-0 text-body-secondary">Продукти за грижа, стилизиране и вдъхновение.</p>
            </article>
          </div>
          <div class="col-md-4">
            <article class="feature-card h-100 p-4">
              <h2 class="h4">Лесен избор</h2>
              <p class="mb-0 text-body-secondary">Ясна информация, която помага да откриете подходящата грижа.</p>
            </article>
          </div>
          <div class="col-md-4">
            <article class="feature-card h-100 p-4">
              <h2 class="h4">Салонно отношение</h2>
              <p class="mb-0 text-body-secondary">Внимание към всеки детайл от избора до грижата у дома.</p>
            </article>
          </div>
        </div>
      </div>
    </section>
  `;

  return main;
}
