package com.acme.order.client.dto;

public class ReserveStockRequest {
    private final String sku;
    private final int quantity;

    public ReserveStockRequest(String sku, int quantity) {
        this.sku = sku;
        this.quantity = quantity;
    }

    public String getSku() { return sku; }
    public int getQuantity() { return quantity; }
}
