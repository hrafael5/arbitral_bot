document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const forgotPasswordForm = document.getElementById('forgot-password-form');
    const resetPasswordForm = document.getElementById('reset-password-form');
    const errorMessageEl = document.getElementById('error-message');
    const successMessageEl = document.getElementById('success-message');

    // Função para mostrar mensagens
    function showMessage(message, type = 'error') {
        hideMessages();
        const messageEl = type === 'error' ? errorMessageEl : successMessageEl;
        if (messageEl) {
            messageEl.textContent = message;
            messageEl.style.display = 'block';
        }
    }

    function hideMessages() {
        if (errorMessageEl) errorMessageEl.style.display = 'none';
        if (successMessageEl) successMessageEl.style.display = 'none';
    }

    // Função para mostrar/esconder loading
    function setLoading(button, isLoading) {
        const buttonText = button.querySelector('.button-text');
        const spinner = button.querySelector('.loading-spinner');
        
        if (isLoading) {
            buttonText.style.display = 'none';
            spinner.style.display = 'flex';
            button.disabled = true;
        } else {
            buttonText.style.display = 'block';
            spinner.style.display = 'none';
            button.disabled = false;
        }
    }

    // Função para validar força da senha
    function checkPasswordStrength(password) {
        let score = 0;
        let feedback = '';

        if (password.length >= 8) score++;
        if (password.length >= 12) score++;
        if (/[a-z]/.test(password)) score++;
        if (/[A-Z]/.test(password)) score++;
        if (/[0-9]/.test(password)) score++;
        if (/[^A-Za-z0-9]/.test(password)) score++;

        if (score < 3) {
            feedback = 'Senha fraca';
            return { strength: 'weak', feedback, score };
        } else if (score < 4) {
            feedback = 'Senha razoável';
            return { strength: 'fair', feedback, score };
        } else if (score < 5) {
            feedback = 'Senha boa';
            return { strength: 'good', feedback, score };
        } else {
            feedback = 'Senha forte';
            return { strength: 'strong', feedback, score };
        }
    }

    // Função para atualizar indicador de força da senha
    function updatePasswordStrength(passwordInput, strengthFill, strengthText) {
        const password = passwordInput.value;
        
        if (!password) {
            strengthFill.className = 'strength-fill';
            strengthFill.style.width = '0%';
            strengthText.textContent = 'Digite uma senha';
            return;
        }

        const { strength, feedback } = checkPasswordStrength(password);
        strengthFill.className = `strength-fill ${strength}`;
        strengthText.textContent = feedback;
    }

    // Configurar indicadores de força da senha
    const passwordInputs = [
        { input: 'password', fill: 'strength-fill', text: 'strength-text' },
        { input: 'newPassword', fill: 'new-strength-fill', text: 'new-strength-text' }
    ];

    passwordInputs.forEach(({ input, fill, text }) => {
        const passwordInput = document.getElementById(input);
        const strengthFill = document.getElementById(fill);
        const strengthText = document.getElementById(text);

        if (passwordInput && strengthFill && strengthText) {
            passwordInput.addEventListener('input', () => {
                updatePasswordStrength(passwordInput, strengthFill, strengthText);
            });
        }
    });

    // Configurar botões de mostrar/esconder senha
    const passwordToggles = [
        { toggle: 'password-toggle', input: 'password' },
        { toggle: 'confirm-password-toggle', input: 'confirmPassword' },
        { toggle: 'new-password-toggle', input: 'newPassword' }
    ];

    passwordToggles.forEach(({ toggle, input }) => {
        const toggleBtn = document.getElementById(toggle);
        const passwordInput = document.getElementById(input);

        if (toggleBtn && passwordInput) {
            toggleBtn.addEventListener('click', () => {
                const eyeIcon = toggleBtn.querySelector('.eye-icon');
                const eyeOffIcon = toggleBtn.querySelector('.eye-off-icon');
                
                if (passwordInput.type === 'password') {
                    passwordInput.type = 'text';
                    eyeIcon.style.display = 'none';
                    eyeOffIcon.style.display = 'block';
                } else {
                    passwordInput.type = 'password';
                    eyeIcon.style.display = 'block';
                    eyeOffIcon.style.display = 'none';
                }
            });
        }
    });

    // Validação de confirmação de senha
    const confirmPasswordInput = document.getElementById('confirmPassword');
    if (confirmPasswordInput) {
        confirmPasswordInput.addEventListener('input', () => {
            const password = document.getElementById('password').value;
            const confirmPassword = confirmPasswordInput.value;
            
            if (confirmPassword && password !== confirmPassword) {
                confirmPasswordInput.setCustomValidity('As senhas não coincidem');
            } else {
                confirmPasswordInput.setCustomValidity('');
            }
        });
    }

    // Formulário de cadastro
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            hideMessages();
            
            const name = document.getElementById('name').value;
            const email = document.getElementById('email').value;
            const whatsapp = document.getElementById('whatsapp').value;
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            const registerButton = document.getElementById('register-button');

            // Validações do lado cliente
            if (password !== confirmPassword) {
                showMessage('As senhas não coincidem.', 'error');
                return;
            }

            const { score } = checkPasswordStrength(password);
            if (score < 3) {
                showMessage('A senha deve ser mais forte. Use pelo menos 8 caracteres, incluindo letras, números e símbolos.', 'error');
                return;
            }

            setLoading(registerButton, true);

            try {
                const response = await fetch('/api/users/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email, whatsapp, password })
                });

                const data = await response.json();

                if (response.ok) {
                    showMessage('Conta criada com sucesso! Redirecionando...', 'success');
                    setTimeout(() => {
                        window.location.href = '/';
                    }, 1500);
                } else {
                    showMessage(data.message || 'Erro no cadastro.', 'error');
                }
            } catch (error) {
                console.error('Erro no cadastro:', error);
                showMessage('Erro de conexão com o servidor.', 'error');
            } finally {
                setLoading(registerButton, false);
            }
        });
    }

    // Formulário de login
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            hideMessages();
            
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const loginButton = document.getElementById('login-button');

            setLoading(loginButton, true);

            try {
                const response = await fetch('/api/users/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });

                const data = await response.json();

                if (response.ok) {
                    showMessage('Login realizado com sucesso! Redirecionando...', 'success');
                    setTimeout(() => {
                        window.location.href = '/';
                    }, 1000);
                } else {
                    showMessage(data.message || 'Erro no login.', 'error');
                }
            } catch (error) {
                console.error('Erro no login:', error);
                showMessage('Erro de conexão com o servidor.', 'error');
            } finally {
                setLoading(loginButton, false);
            }
        });
    }

    // Formulário de esqueci a senha
    if (forgotPasswordForm) {
        forgotPasswordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value;
            const messageEl = document.getElementById('message');
            const forgotButton = document.getElementById('forgot-button');
            
            setLoading(forgotButton, true);
            
            try {
                const response = await fetch('/api/users/forgot-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    messageEl.className = 'auth-message success';
                    messageEl.style.display = 'block';
                    messageEl.textContent = data.message;
                    
                    if (data.resetToken) {
                        document.getElementById('token').value = data.resetToken;
                        document.getElementById('reset-form').style.display = 'block';
                    }
                } else {
                    messageEl.className = 'auth-message error';
                    messageEl.style.display = 'block';
                    messageEl.textContent = data.message;
                }
            } catch (error) {
                console.error('Erro na recuperação:', error);
                messageEl.className = 'auth-message error';
                messageEl.style.display = 'block';
                messageEl.textContent = 'Erro de conexão. Tente novamente.';
            } finally {
                setLoading(forgotButton, false);
            }
        });
    }
    
    // Formulário de redefinir senha
    if (resetPasswordForm) {
        resetPasswordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const token = document.getElementById('token').value;
            const newPassword = document.getElementById('newPassword').value;
            const messageEl = document.getElementById('message');
            const resetButton = document.getElementById('reset-button');

            // Validar força da senha
            const { score } = checkPasswordStrength(newPassword);
            if (score < 3) {
                messageEl.className = 'auth-message error';
                messageEl.style.display = 'block';
                messageEl.textContent = 'A senha deve ser mais forte. Use pelo menos 8 caracteres, incluindo letras, números e símbolos.';
                return;
            }
            
            setLoading(resetButton, true);
            
            try {
                const response = await fetch('/api/users/reset-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token, newPassword })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    messageEl.className = 'auth-message success';
                    messageEl.style.display = 'block';
                    messageEl.textContent = data.message + ' Redirecionando para o login...';
                    setTimeout(() => {
                        window.location.href = '/login.html';
                    }, 2000);
                } else {
                    messageEl.className = 'auth-message error';
                    messageEl.style.display = 'block';
                    messageEl.textContent = data.message;
                }
            } catch (error) {
                console.error('Erro ao redefinir senha:', error);
                messageEl.className = 'auth-message error';
                messageEl.style.display = 'block';
                messageEl.textContent = 'Erro de conexão. Tente novamente.';
            } finally {
                setLoading(resetButton, false);
            }
        });
    }
});

