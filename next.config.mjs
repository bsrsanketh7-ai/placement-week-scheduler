/** @type {import('next').NextConfig} */
export default {
  // The scheduling core is plain TypeScript with no server dependencies, so the
  // whole app is static. Useful on the day: it runs off a laptop with no
  // network, which is the environment a placement week actually has.
  output: 'export',
  // Opening the dev server from another device on the LAN (a phone, a second
  // laptop) needs that origin allowed. Machine specific, so it comes from the
  // environment: DEV_ORIGINS=192.168.1.9 npm run dev
  allowedDevOrigins: process.env.DEV_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean) ?? [],
};
