import { HPLClient } from "@research-ag/hpl-client";

function CreateToken(client: HPLClient, newFtDecimals: number, newFtDescription: string) {
    return client.ledger.createFungibleToken(newFtDecimals, newFtDescription);
}