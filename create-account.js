const form = document.getElementById('accountForm');
      const statusBox = document.getElementById('statusBox');

      form.addEventListener('submit', function (event) {
        event.preventDefault();

        const fullName = document.getElementById('fullName').value.trim();
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirmPassword').value;

        if (!fullName || !email || !password || !confirmPassword) {
          statusBox.textContent = 'Please complete all required fields.';
          statusBox.classList.add('visible');
          return;
        }

        if (password !== confirmPassword) {
          statusBox.textContent = 'Passwords do not match. Please try again.';
          statusBox.classList.add('visible');
          return;
        }

        statusBox.textContent = `Account created for ${email}. Redirecting to sign in...`;
        statusBox.classList.add('visible');

        form.querySelector('button[type="submit"]').disabled = true;
        form.querySelector('button[type="submit"]').textContent = 'Creating account...';

        setTimeout(() => {
          window.location.href = 'signin.html';
        }, 900);
      });
