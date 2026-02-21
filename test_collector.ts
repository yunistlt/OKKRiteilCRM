import { collectStageEvidence } from './lib/stage-collector';

async function main() {
    console.log('Running collectStageEvidence for 50839...');
    // We pass 50839 as orderId, 'some-status' as status, and a very old entryTime to get everything
    const evidence = await collectStageEvidence(50839, 'some-status', '2020-01-01T00:00:00Z');

    console.log('Interactions found:', evidence.interactions.length);
    evidence.interactions.forEach(i => {
        console.log(`[${i.type}] at ${i.timestamp}`);
        if (i.type === 'call') {
            console.log(`Transcript length: ${i.content ? i.content.length : 0}`);
        }
    });
}
main();
