export function createAuthPageLayout({ eyebrow, title, introduction }) {
  const main = document.createElement('main');
  main.className = 'auth-page py-4 py-md-5';
  main.innerHTML = `
    <div class="container">
      <div class="row justify-content-center">
        <div class="col-12 col-md-9 col-lg-7 col-xl-6">
          <section class="auth-card p-4 p-md-5" aria-labelledby="auth-page-title">
            <p class="eyebrow mb-2"></p>
            <h1 id="auth-page-title" class="h2 mb-3"></h1>
            <p class="text-body-secondary mb-4"></p>
            <div class="auth-page-content"></div>
          </section>
        </div>
      </div>
    </div>
  `;

  main.querySelector('.eyebrow').textContent = eyebrow;
  main.querySelector('#auth-page-title').textContent = title;
  main.querySelector('.text-body-secondary').textContent = introduction;

  return {
    main,
    content: main.querySelector('.auth-page-content'),
  };
}

export function createFormField({
  id,
  label,
  type = 'text',
  autocomplete,
  required = false,
  minLength,
  passwordToggle = false,
}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'mb-3';

  const formLabel = document.createElement('label');
  formLabel.className = 'form-label fw-semibold';
  formLabel.htmlFor = id;
  formLabel.textContent = label;

  const input = document.createElement('input');
  input.className = 'form-control';
  input.id = id;
  input.name = id;
  input.type = type;
  input.autocomplete = autocomplete;
  input.required = required;

  if (minLength) {
    input.minLength = minLength;
  }

  if (!passwordToggle) {
    wrapper.append(formLabel, input);
    return { wrapper, input };
  }

  const inputGroup = document.createElement('div');
  inputGroup.className = 'input-group';
  const toggle = document.createElement('button');
  toggle.className = 'btn btn-outline-primary auth-password-toggle';
  toggle.type = 'button';
  toggle.setAttribute('aria-controls', id);
  toggle.setAttribute('aria-pressed', 'false');
  toggle.setAttribute('aria-label', 'Покажи паролата');
  toggle.textContent = 'Покажи';
  toggle.addEventListener('click', () => {
    const isVisible = input.type === 'text';
    input.type = isVisible ? 'password' : 'text';
    toggle.setAttribute('aria-pressed', String(!isVisible));
    toggle.setAttribute('aria-label', isVisible ? 'Покажи паролата' : 'Скрий паролата');
    toggle.textContent = isVisible ? 'Покажи' : 'Скрий';
  });

  inputGroup.append(input, toggle);
  wrapper.append(formLabel, inputGroup);
  return { wrapper, input, toggle };
}
