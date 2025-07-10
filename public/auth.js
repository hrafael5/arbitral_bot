document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const errorMessageEl = document.getElementById('error-message');

    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            errorMessageEl.textContent = '';
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;

            try {
                const response = await fetch('/api/users/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });

                if (response.ok) {
                    // Se o cadastro for bem-sucedido, redireciona para o dashboard
                    window.location.href = '/';
                } else {
                    const errorText = await response.text();
                    errorMessageEl.textContent = errorText;
                }
            } catch (error) {
                errorMessageEl.textContent = 'Erro de conexão com o servidor.';
            }
        });
    }

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            errorMessageEl.textContent = '';
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;

            try {
                const response = await fetch('/api/users/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });

                if (response.ok) {
                    // Se o login for bem-sucedido, redireciona para o dashboard
                    window.location.href = '/';
                } else {
                    const errorText = await response.text();
                    errorMessageEl.textContent = errorText;
                }
            } catch (error) {
                errorMessageEl.textContent = 'Erro de conexão com o servidor.';
            }
        });
    }
});