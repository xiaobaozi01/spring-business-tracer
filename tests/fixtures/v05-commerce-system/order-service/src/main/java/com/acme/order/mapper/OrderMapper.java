package com.acme.order.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface OrderMapper {
    void insertOrder(@Param("bizNo") String bizNo, @Param("customerId") Long customerId);
}
