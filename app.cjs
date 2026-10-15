// Startup file for Phusion Passenger hosts (cPanel "Setup Node.js App"),
// which load a CommonJS file. The hosted server itself is an ES module.
import('./server/hosted/app.mjs').catch((error) => {
  console.error(error);
  process.exit(1);
});
