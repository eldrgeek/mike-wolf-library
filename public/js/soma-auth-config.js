// SOMA Auth config for The Library (library.mike-wolf.com).
// Publishable key — safe in client-side code.
//
// The Library is a PUBLIC ARCHIVE and stays zero-auth for readers, forever.
// Nothing on this site requires an account to read, search, or browse. This
// file is only ever fetched on the admin path (see the bootstrap in
// src/layouts/Base.astro): an anonymous visitor never loads it, so the public
// read path stays 100% static with zero extra requests.
//
// Signing in unlocks exactly one thing: in-place copy editing for app admins
// (SOMA App Standard §17 / §17a).
window.SOMA_AUTH_CONFIG = {
  url: 'https://omfwcodoimjmbrhssvfl.supabase.co',
  anonKey: 'sb_publishable_vi2qDWjozUJ5mi9dwirkLA_rj6UaqLf',

  methods: {
    magicLink: true,
    emailOtp: false,
    password: false,
    phone: false,
    oauth: ['google']
  }
};
