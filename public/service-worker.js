self.addEventListener('install', e => console.log('Shelby Protocol installed'));
self.addEventListener('fetch', e => e.respondWith(fetch(e.request)));