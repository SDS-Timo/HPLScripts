export {};

declare global {
    var transactions: any[] = [];
    var counter: number = 0;
    var higher_gauge: Map<string, number> = new Map();
    var lower_gauge: Map<string, number> = new Map();
    var date: number = 0;
}

