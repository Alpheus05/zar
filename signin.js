const form = document.getElementById("loginForm");
const statusBox = document.getElementById("loginStatus");

form.addEventListener("submit", function (event) {
  event.preventDefault();

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();

  if (!email || !password) {
    statusBox.textContent = "Please enter both your email and password.";
    statusBox.classList.add("visible");
    return;
  }

  statusBox.textContent = `Welcome back, ${email}. Redirecting to your dashboard...`;
  statusBox.classList.add("visible");

  form.querySelector('button[type="submit"]').disabled = true;
  form.querySelector('button[type="submit"]').textContent = "Signing in...";

  setTimeout(() => {
    window.location.href = "user-home.html";
  }, 800);
});
