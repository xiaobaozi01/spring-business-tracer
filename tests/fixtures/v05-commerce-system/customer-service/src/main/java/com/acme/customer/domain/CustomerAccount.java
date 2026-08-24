package com.acme.customer.domain;

import javax.persistence.Entity;
import javax.persistence.Id;
import javax.persistence.Table;

@Entity
@Table(name = "customer_account", schema = "crm")
public class CustomerAccount {
    @Id
    private Long id;
    private String status;

    public boolean isActive() {
        return "ACTIVE".equals(status);
    }
}
