package com.acme.account.domain;

import javax.persistence.Entity;
import javax.persistence.Id;
import javax.persistence.Table;

@Entity
@Table(name = "customer_account", schema = "account")
public class CustomerAccount {
    @Id
    private Long id;
    private String status;

    public void activate() {
        this.status = "ACTIVE";
    }
}
