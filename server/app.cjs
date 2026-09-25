// Startup file for cPanel's "Setup Node.js App" (register.lk and other CloudLinux / LiteSpeed hosts).
// The host loads this file with require(); the server itself is an ES module, so it is imported from here.
// The host decides where it listens: src/index.js takes PORT, and LiteSpeed's loader takes over listen().
import('./src/index.js').catch(e => { console.error('Regal server failed to start:', e); process.exit(1); });
