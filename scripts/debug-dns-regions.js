
const dns = require('dns');

function check(host) {
    console.log(`Checking ${host}...`);
    dns.lookup(host, (err, address) => {
        if (err) console.error(`${host} -> FAILED`);
        else console.log(`${host} -> ${address}`);
    });
}

check('aws-0-eu-central-1.pooler.supabase.com');
check('aws-0-eu-west-1.pooler.supabase.com');
check('aws-1-eu-west-1.pooler.supabase.com'); // User provided this one
check('db.lywtzgntmibdpgoijbty.supabase.co'); // Direct (failed earlier)
