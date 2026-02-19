
const dns = require('dns');

function check(host) {
    console.log(`Looking up ${host}...`);
    dns.lookup(host, (err, address) => {
        if (err) console.error(`${host} failed:`, err.code);
        else console.log(`${host} IP:`, address);
    });
}

check('google.com');
check('db.lywtzgntmibdpgoijbty.supabase.co');
