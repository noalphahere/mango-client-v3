import { Account, PublicKey } from '@solana/web3.js';
import { expect } from 'chai';
import * as Test from './utils';
import { MerpsClient } from '../src';
import MerpsGroup, { QUOTE_INDEX } from '../src/MerpsGroup';
import { sleep, zeroKey } from '../src/utils';
import MerpsAccount from '../src/MerpsAccount';


describe('MerpsClient', async () => {
  let client: MerpsClient;
  let payer: Account;
  const connection = Test.createDevnetConnection();

  before(async () => {
    client = new MerpsClient(connection, Test.MerpsProgramId);
    sleep(2000); // sleeping because devnet rate limits suck
    payer = await Test.createAccount(connection);
    sleep(2000); // sleeping because devnet rate limits suck
  });

  describe('ralfsTests', async () => {
    it('1_ralfsTest', async () => {
      sleep(1000); // sleeping because devnet rate limits suck
      const productPk = new PublicKey('3m1y5h2uv7EQL3KaJZehvAJa4yDNvgc5yAdL9KPMKwvk');
      const pricePk = new PublicKey('HovQMDrbAgAYPCmHVSrezcSmkMtXSSUsLDFANExrZh2J');
      // const ai = await connection.getAccountInfo(pricePk);
      // if (ai){
      //   console.log(ai.data.byteLength);
      //   console.log(ai);
      // }

      await client.testRalfs(
        productPk,
        pricePk,
        payer,
      )
    });
  });
});
