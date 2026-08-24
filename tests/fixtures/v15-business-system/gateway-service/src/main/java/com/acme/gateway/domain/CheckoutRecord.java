package com.acme.gateway.domain;

import javax.persistence.Entity;
import javax.persistence.GeneratedValue;
import javax.persistence.Id;
import javax.persistence.Table;

@Entity
@Table(name = "checkout_record", schema = "sales")
public class CheckoutRecord {
    @Id @GeneratedValue private Long id;
    private String sku;
    private String status;
    protected CheckoutRecord() {}
    public CheckoutRecord(String sku, String status) { this.sku = sku; this.status = status; }
}
