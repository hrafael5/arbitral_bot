document.addEventListener('DOMContentLoaded', () => {

    // --- LÓGICA DE REGISTRO ---
    const registerForm = document.getElementById('register-form');
    if (registerForm) {
        const registerButton = document.getElementById('register-button');
        const buttonText = registerButton.querySelector('.button-text');
        const spinner = registerButton.querySelector('.loading-spinner');
        const formErrorMessage = document.getElementById('form-error-message');

        const fields = {
            name: { input: document.getElementById('name'), error: document.getElementById('name-error') },
            email: { input: document.getElementById('email'), error: document.getElementById('email-error') },
            whatsapp: { input: document.getElementById('whatsapp'), error: document.getElementById('whatsapp-error') },
            password: { input: document.getElementById('password'), error: document.getElementById('password-error') },
            confirmPassword: { input: document.getElementById('confirmPassword'), error: document.getElementById('confirmPassword-error') }
        };

        function setLoading(button, isLoading) {
            const textEl = button.querySelector('.button-text');
            const spinnerEl = button.querySelector('.loading-spinner');
            if (isLoading) {
                button.disabled = true;
                if(textEl) textEl.style.display = 'none';
                if(spinnerEl) spinnerEl.style.display = 'block';
            } else {
                button.disabled = false;
                if(textEl) textEl.style.display = 'block';
                if(spinnerEl) spinnerEl.style.display = 'none';
            }
        }

        function clearAllErrors() {
            if(formErrorMessage) {
                formErrorMessage.style.display = 'none';
                formErrorMessage.textContent = '';
                formErrorMessage.classList.remove('success', 'error');
            }
            for (const key in fields) {
                if (fields[key].input) {
                    fields[key].input.classList.remove('is-invalid');
                }
                if (fields[key].error) {
                    fields[key].error.textContent = '';
                }
            }
        }

        function displayError(fieldKey, message, isSuccess = false) {
            if (fields[fieldKey] && fields[fieldKey].input) {
                fields[fieldKey].input.classList.add('is-invalid');
                fields[fieldKey].error.textContent = message;
            } else if (formErrorMessage) {
                formErrorMessage.textContent = message;
                formErrorMessage.classList.remove('success', 'error');
                formErrorMessage.classList.add(isSuccess ? 'success' : 'error');
                formErrorMessage.style.display = 'block';
            }
        }

        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearAllErrors();

            let isValid = true;
            if (fields.name.input.value.trim().length < 2) {
                displayError('name', 'O nome deve ter pelo menos 2 caracteres.');
                isValid = false;
            }
            if (!/^\S+@\S+\.\S+$/.test(fields.email.input.value)) {
                displayError('email', 'Por favor, insira um e-mail válido.');
                isValid = false;
            }
            if (fields.password.input.value.length < 8) {
                displayError('password', 'A senha precisa ter no mínimo 8 caracteres.');
                isValid = false;
            }
            if (fields.password.input.value !== fields.confirmPassword.input.value) {
                displayError('confirmPassword', 'As senhas não coincidem.');
                isValid = false;
            }
            if (!isValid) return;

            setLoading(registerButton, true);

            const formData = {
                name: fields.name.input.value.trim(),
                email: fields.email.input.value.trim(),
                whatsapp: fields.whatsapp.input.value.trim(),
                password: fields.password.input.value
            };

            try {
                const response = await fetch('/api/users/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });

                const data = await response.json();

                if (response.ok) {
                    displayError(null, 'Conta criada com sucesso! Redirecionando...', true);
                    setTimeout(() => {
                        window.location.href = '/dashboard.html'; // Redireciona para o dashboard
                    }, 1500);
                } else {
                    const errorMessage = data.message || 'Ocorreu um erro no cadastro.';
                    if (errorMessage.toLowerCase().includes('email')) {
                        displayError('email', errorMessage);
                    } else if (errorMessage.toLowerCase().includes('senha')) {
                        displayError('password', errorMessage);
                    } else if (errorMessage.toLowerCase().includes('nome')) {
                        displayError('name', errorMessage);
                    } else {
                        displayError(null, errorMessage);
                    }
                }
            } catch (error) {
                console.error('Erro de conexão:', error);
                displayError(null, 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.');
            } finally {
                setLoading(registerButton, false);
            }
        });
    }

    // --- LÓGICA DE LOGIN ---
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        const loginButton = document.getElementById('login-button');
        const formErrorMessage = document.getElementById('form-error-message');

        const fields = {
            email: { input: document.getElementById('email'), error: document.getElementById('email-error') },
            password: { input: document.getElementById('password'), error: document.getElementById('password-error') }
        };

        function setLoading(button, isLoading) {
            const textEl = button.querySelector('.button-text');
            const spinnerEl = button.querySelector('.loading-spinner');
            if (isLoading) {
                button.disabled = true;
                if(textEl) textEl.style.display = 'none';
                if(spinnerEl) spinnerEl.style.display = 'block';
            } else {
                button.disabled = false;
                if(textEl) textEl.style.display = 'block';
                if(spinnerEl) spinnerEl.style.display = 'none';
            }
        }

        function clearAllErrors() {
            if(formErrorMessage) {
                formErrorMessage.style.display = 'none';
                formErrorMessage.textContent = '';
                formErrorMessage.classList.remove('success', 'error');
            }
            for (const key in fields) {
                if (fields[key].input) fields[key].input.classList.remove('is-invalid');
                if (fields[key].error) fields[key].error.textContent = '';
            }
        }

        function displayError(fieldKey, message, isSuccess = false) {
            if (fields[fieldKey] && fields[fieldKey].input) {
                fields[fieldKey].input.classList.add('is-invalid');
                fields[fieldKey].error.textContent = message;
            } else if (formErrorMessage) {
                formErrorMessage.textContent = message;
                formErrorMessage.classList.remove('success', 'error');
                formErrorMessage.classList.add(isSuccess ? 'success' : 'error');
                formErrorMessage.style.display = 'block';
            }
        }

        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearAllErrors();

            const email = fields.email.input.value;
            const password = fields.password.input.value;

            if (!email || !password) {
                displayError(null, 'Por favor, preencha o e-mail e a senha.');
                return;
            }

            setLoading(loginButton, true);

            try {
                const response = await fetch('/api/users/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });

                const data = await response.json();

                if (response.ok) {
                    displayError(null, 'Login realizado com sucesso! Redirecionando...', true);
                    setTimeout(() => {
                        // --- CORREÇÃO APLICADA AQUI ---
                        window.location.href = '/dashboard.html';
                    }, 1000);
                } else {
                    displayError(null, data.message || 'E-mail ou senha inválidos.');
                    fields.email.input.classList.add('is-invalid');
                    fields.password.input.classList.add('is-invalid');
                }
            } catch (error) {
                console.error('Erro de conexão:', error);
                displayError(null, 'Não foi possível conectar ao servidor.');
            } finally {
                setLoading(loginButton, false);
            }
        });
    }

    // --- LÓGICA COMUM (FORÇA DA SENHA, MOSTRAR/ESCONDER SENHA) ---
    function checkPasswordStrength(password) {
        let score = 0;
        if (password.length >= 8) score++;
        if (password.length >= 12) score++;
        if (/[a-z]/.test(password)) score++;
        if (/[A-Z]/.test(password)) score++;
        if (/[0-9]/.test(password)) score++;
        if (/[^A-Za-z0-9]/.test(password)) score++;
        if (score < 3) return { strength: 'weak', feedback: 'Senha fraca' };
        if (score < 4) return { strength: 'fair', feedback: 'Senha razoável' };
        if (score < 5) return { strength: 'good', feedback: 'Senha boa' };
        return { strength: 'strong', feedback: 'Senha forte' };
    }

    function updatePasswordStrengthUI(passwordInput, strengthFill, strengthText) {
        const password = passwordInput.value;
        if (!password) {
            strengthFill.className = 'strength-fill';
            strengthText.textContent = 'Digite uma senha';
            return;
        }
        const { strength, feedback } = checkPasswordStrength(password);
        strengthFill.className = `strength-fill ${strength}`;
        strengthText.textContent = feedback;
    }

    const passwordStrengthInput = document.getElementById('password');
    if (passwordStrengthInput) {
        const strengthFill = document.getElementById('strength-fill');
        const strengthText = document.getElementById('strength-text');
        if (strengthFill && strengthText) {
            passwordStrengthInput.addEventListener('input', () => {
                updatePasswordStrengthUI(passwordStrengthInput, strengthFill, strengthText);
            });
        }
    }

    const passwordToggles = document.querySelectorAll('.password-toggle');
    passwordToggles.forEach(toggle => {
        toggle.addEventListener('click', () => {
            const container = toggle.closest('.password-input-container');
            const passwordInput = container.querySelector('input');
            const eyeIcon = toggle.querySelector('.eye-icon');
            const eyeOffIcon = toggle.querySelector('.eye-off-icon');

            if (passwordInput.type === 'password') {
                passwordInput.type = 'text';
                if(eyeIcon) eyeIcon.style.display = 'none';
                if(eyeOffIcon) eyeOffIcon.style.display = 'block';
            } else {
                passwordInput.type = 'password';
                if(eyeIcon) eyeIcon.style.display = 'block';
                if(eyeOffIcon) eyeOffIcon.style.display = 'none';
            }
        });
    });
});
