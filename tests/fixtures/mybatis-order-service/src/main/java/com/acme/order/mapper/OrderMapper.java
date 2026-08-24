package com.acme.order.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface OrderMapper {
    boolean existsByBizNo(@Param("bizNo") String bizNo);

    void insertOrder(@Param("bizNo") String bizNo, @Param("customerId") Long customerId);

    Long findIdByBizNo(@Param("bizNo") String bizNo);
}
