export {};

declare global {
    var transactions: any[] = [];
    var counter: number = 0;
    var high_gauge: Map<string, number> = new Map();
    var high_gauge_dates: Map<string, number> = new Map();
    var date: number = 0;
}

