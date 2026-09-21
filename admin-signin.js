const adminForm = document.getElementById('adminLoginForm');
      const adminStatus = document.getElementById('adminStatus');

      adminForm.addEventListener('submit', function (event) {
        event.preventDefault();

        const email = document.getElementById('adminEmail').value.trim();
        const password = document.getElementById('adminPassword').value.trim();

        if (!email || !password) {
          adminStatus.textContent = 'Please enter your admin email and password.';
          adminStatus.classList.add('visible');
          return;
        }

        adminStatus.textContent = `Welcome back, ${email}. Opening the admin dashboard...`;
        adminStatus.classList.add('visible');

        adminForm.querySelector('button[type="submit"]').disabled = true;
        adminForm.querySelector('button[type="submit"]').textContent = 'Opening...';

        setTimeout(() => {
          window.location.href = 'index.html';
        }, 800);
      });
