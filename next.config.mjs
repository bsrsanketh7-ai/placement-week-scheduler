/** @type {import('next').NextConfig} */
export default {
  // The scheduling core is plain TypeScript with no server dependencies, so the
  // whole app is static. Useful on the day: it runs off a laptop with no
  // network, which is the environment a placement week actually has.
  output: 'export',
};
